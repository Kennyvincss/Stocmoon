// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {FPMMMath} from "./libraries/FPMMMath.sol";

/// @title StocMoonMarkets
/// @notice Programmable binary markets on tokenized-stock reference prices, collateralised in USDC and priced
///         by a fixed-product market maker (FPMM).
///
///         Market kinds
///           UP_DOWN : YES = asset closes ABOVE its opening reference price, NO = BELOW, equal = PUSH.
///           BATTLE  : YES = asset A has the higher % return, NO = asset B, equal = PUSH.
///           EVENT   : YES/NO question (e.g. earnings) resolved by RESOLVER_ROLE with a dispute window.
///
///         Shares are ERC-1155: id = marketId*2 (YES) and marketId*2+1 (NO). One share has the collateral's
///         decimals and redeems for 1 USDC if it wins, 0.5 USDC on PUSH/INVALID, 0 if it loses.
///
///         Every settlement parameter is copied into the market at creation and can never be changed.
contract StocMoonMarkets is ERC1155Supply, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================ roles & constants

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant ELIGIBILITY_ROLE = keccak256("ELIGIBILITY_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_TOTAL_FEE_BPS = 500; // 5% hard cap
    uint256 private constant ACC_PRECISION = 1e18;

    // ================================================================ types

    enum Kind {
        UP_DOWN,
        BATTLE,
        EVENT
    }

    enum Status {
        NONE,
        OPEN,
        PROPOSED,
        RESOLVED
    }

    enum Outcome {
        NONE,
        YES,
        NO,
        PUSH,
        INVALID
    }

    struct Market {
        Kind kind;
        Status status;
        Outcome outcome;
        Outcome proposedOutcome;
        uint16 lpFeeBps;
        uint16 protocolFeeBps;
        uint32 maxStaleness;
        uint32 settlementDelay;
        uint32 resolutionWindow;
        uint32 disputeWindow;
        uint64 openTime;
        uint64 tradingEndsAt;
        uint64 closeTime;
        uint64 proposedAt;
        address creator;
        address assetA;
        address feedA;
        address assetB;
        address feedB;
        int256 openPriceA;
        int256 openPriceB;
        int256 closePriceA;
        int256 closePriceB;
        uint80 openRoundA;
        uint80 openRoundB;
        bytes32 metadataHash;
        uint256 poolYes;
        uint256 poolNo;
        uint256 totalLpShares;
        uint256 collateral;
        uint256 lpFeeAccPerShare;
        uint256 lpFeeReserve;
    }

    struct DurationConfig {
        bool enabled;
        uint32 tradingCutoff;
    }

    // ================================================================ storage

    IERC20 public immutable collateralToken;
    OracleAdapter public immutable oracle;

    uint256 public marketCount;
    mapping(uint256 => Market) private _markets;

    mapping(uint256 => mapping(address => uint256)) public lpShares;
    mapping(uint256 => mapping(address => uint256)) private _feeDebt;
    mapping(uint256 => mapping(address => uint256)) private _pendingFees;

    mapping(uint32 => DurationConfig) public durations;

    uint16 public lpFeeBps;
    uint16 public protocolFeeBps;
    uint32 public settlementDelay;
    uint32 public resolutionWindow;
    uint32 public disputeWindow;
    uint256 public minInitialLiquidity;
    bool public openCreation;

    bool public eligibilityRequired;
    mapping(address => bool) public isEligible;

    uint256 public protocolFeesAccrued;
    /// @notice LP fees owed but not yet paid (accounting only).
    uint256 public lpFeesOutstanding;

    // ================================================================ events

    event MarketCreated(
        uint256 indexed marketId,
        Kind indexed kind,
        address indexed creator,
        address assetA,
        address assetB,
        int256 openPriceA,
        int256 openPriceB,
        uint64 openTime,
        uint64 tradingEndsAt,
        uint64 closeTime,
        bytes32 metadataHash
    );
    event EventMarketDetails(uint256 indexed marketId, string question, string rulesURI);
    event MarketParams(
        uint256 indexed marketId,
        address feedA,
        address feedB,
        uint80 openRoundA,
        uint80 openRoundB,
        uint32 maxStaleness,
        uint32 settlementDelay,
        uint32 resolutionWindow,
        uint32 disputeWindow,
        uint16 lpFeeBps,
        uint16 protocolFeeBps
    );
    event Trade(
        uint256 indexed marketId,
        address indexed trader,
        bool indexed isYes,
        bool isBuy,
        uint256 collateralAmount,
        uint256 shares,
        uint256 fee,
        uint256 poolYes,
        uint256 poolNo
    );
    event LiquidityAdded(
        uint256 indexed marketId,
        address indexed provider,
        uint256 amount,
        uint256 lpShares,
        uint256 yesBack,
        uint256 noBack
    );
    event LiquidityRemoved(
        uint256 indexed marketId,
        address indexed provider,
        uint256 lpShares,
        uint256 yesAmount,
        uint256 noAmount,
        uint256 collateralOut,
        uint256 feesOut
    );
    event LpFeesClaimed(uint256 indexed marketId, address indexed provider, uint256 amount);
    event PositionsSplit(uint256 indexed marketId, address indexed account, uint256 amount);
    event PositionsMerged(uint256 indexed marketId, address indexed account, uint256 amount);
    event MarketResolved(
        uint256 indexed marketId, Outcome outcome, int256 closePriceA, int256 closePriceB, uint80 roundA, uint80 roundB
    );
    event MarketInvalidated(uint256 indexed marketId, address indexed caller, string reason);
    event OutcomeProposed(uint256 indexed marketId, Outcome outcome, address indexed resolver, string evidenceURI);
    event ProposalRejected(uint256 indexed marketId, address indexed guardian, string reason);
    event Redeemed(
        uint256 indexed marketId, address indexed account, uint256 yesBurned, uint256 noBurned, uint256 payout
    );
    event FeesUpdated(uint16 lpFeeBps, uint16 protocolFeeBps);
    event WindowsUpdated(uint32 settlementDelay, uint32 resolutionWindow, uint32 disputeWindow);
    event DurationUpdated(uint32 duration, bool enabled, uint32 tradingCutoff);
    event CreationPolicyUpdated(bool openCreation, uint256 minInitialLiquidity);
    event EligibilityPolicyUpdated(bool required);
    event EligibilitySet(address indexed account, bool eligible);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);

    // ================================================================ errors

    error NotAuthorizedCreator();
    error NotEligible(address account);
    error DurationNotAllowed(uint32 duration);
    error InsufficientInitialLiquidity();
    error InvalidMarket();
    error InvalidParams();
    error WrongKind();
    error WrongStatus();
    error TradingClosed();
    error TooEarly();
    error TooLate();
    error Expired();
    error Slippage();
    error ZeroAmount();
    error NoLiquidity();
    error NothingToRedeem();

    // ================================================================ constructor

    constructor(IERC20 collateral_, OracleAdapter oracle_, address admin, string memory uri_) ERC1155(uri_) {
        if (address(collateral_) == address(0) || address(oracle_) == address(0) || admin == address(0)) {
            revert InvalidParams();
        }
        collateralToken = collateral_;
        oracle = oracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);

        lpFeeBps = 150; // 1.5% to LPs
        protocolFeeBps = 50; // 0.5% to protocol
        settlementDelay = 2 minutes;
        resolutionWindow = 7 days;
        disputeWindow = 24 hours;
        minInitialLiquidity = 10 * 10 ** 6; // 10 USDC (6 decimals)
        emit FeesUpdated(lpFeeBps, protocolFeeBps);
        emit WindowsUpdated(settlementDelay, resolutionWindow, disputeWindow);
        emit CreationPolicyUpdated(false, minInitialLiquidity);
    }

    // ================================================================ modifiers / guards

    function _checkDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert Expired();
    }

    function _requireEligible(address account) internal view {
        if (eligibilityRequired && !isEligible[account]) revert NotEligible(account);
    }

    function _market(uint256 id) internal view returns (Market storage m) {
        m = _markets[id];
        if (m.status == Status.NONE) revert InvalidMarket();
    }

    function _requireTrading(Market storage m) internal view {
        if (m.status != Status.OPEN || block.timestamp >= m.tradingEndsAt) revert TradingClosed();
    }

    // ================================================================ market creation

    /// @notice Create an UP/DOWN market on `asset` closing `duration` seconds from now.
    function createUpDownMarket(address asset, uint32 duration, uint256 initialLiquidity)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        _authorizeCreation(false);
        (uint64 tradingEndsAt, uint64 closeTime) = _schedule(duration);
        (int256 price, uint80 roundId,, address feed, uint32 staleness) = oracle.latestPrice(asset);

        id = _initMarket(Kind.UP_DOWN, tradingEndsAt, closeTime, staleness, bytes32(0));
        Market storage m = _markets[id];
        m.assetA = asset;
        m.feedA = feed;
        m.openPriceA = price;
        m.openRoundA = roundId;
        _emitCreated(id, m);
        _addLiquidity(id, m, msg.sender, initialLiquidity, true);
    }

    /// @notice Create a battle: YES if `assetA` outperforms `assetB` (percentage return) by close.
    function createBattleMarket(address assetA, address assetB, uint32 duration, uint256 initialLiquidity)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (assetA == assetB) revert InvalidParams();
        _authorizeCreation(false);
        (uint64 tradingEndsAt, uint64 closeTime) = _schedule(duration);
        (int256 priceA, uint80 roundA,, address feedA, uint32 stalenessA) = oracle.latestPrice(assetA);
        (int256 priceB, uint80 roundB,, address feedB, uint32 stalenessB) = oracle.latestPrice(assetB);

        id = _initMarket(
            Kind.BATTLE, tradingEndsAt, closeTime, stalenessA > stalenessB ? stalenessB : stalenessA, bytes32(0)
        );
        Market storage m = _markets[id];
        m.assetA = assetA;
        m.feedA = feedA;
        m.openPriceA = priceA;
        m.openRoundA = roundA;
        m.assetB = assetB;
        m.feedB = feedB;
        m.openPriceB = priceB;
        m.openRoundB = roundB;
        _emitCreated(id, m);
        _addLiquidity(id, m, msg.sender, initialLiquidity, true);
    }

    /// @notice Create a YES/NO event market (e.g. earnings). Question, source and rules are fixed here.
    /// @param asset          Related stock (informational; may be zero).
    /// @param tradingEndsAt_ Last moment trading is allowed.
    /// @param closeTime_     Earliest time a resolution may be proposed.
    function createEventMarket(
        address asset,
        string calldata question,
        string calldata rulesURI,
        uint64 tradingEndsAt_,
        uint64 closeTime_,
        uint256 initialLiquidity
    ) external whenNotPaused nonReentrant onlyRole(MARKET_CREATOR_ROLE) returns (uint256 id) {
        _requireEligible(msg.sender);
        if (bytes(question).length == 0 || bytes(rulesURI).length == 0) revert InvalidParams();
        if (tradingEndsAt_ <= block.timestamp || closeTime_ < tradingEndsAt_ || closeTime_ > block.timestamp + 400 days)
        {
            revert InvalidParams();
        }
        bytes32 metadataHash = keccak256(abi.encode(question, rulesURI));
        id = _initMarket(Kind.EVENT, tradingEndsAt_, closeTime_, 0, metadataHash);
        Market storage m = _markets[id];
        m.assetA = asset;
        _emitCreated(id, m);
        emit EventMarketDetails(id, question, rulesURI);
        _addLiquidity(id, m, msg.sender, initialLiquidity, true);
    }

    function _authorizeCreation(bool eventMarket) internal view {
        if (!hasRole(MARKET_CREATOR_ROLE, msg.sender) && (eventMarket || !openCreation)) revert NotAuthorizedCreator();
        _requireEligible(msg.sender);
    }

    function _schedule(uint32 duration) internal view returns (uint64 tradingEndsAt, uint64 closeTime) {
        DurationConfig memory d = durations[duration];
        if (!d.enabled) revert DurationNotAllowed(duration);
        closeTime = uint64(block.timestamp + duration);
        tradingEndsAt = closeTime - d.tradingCutoff;
    }

    function _initMarket(Kind kind, uint64 tradingEndsAt, uint64 closeTime, uint32 staleness, bytes32 metadataHash)
        internal
        returns (uint256 id)
    {
        id = ++marketCount;
        Market storage m = _markets[id];
        m.kind = kind;
        m.status = Status.OPEN;
        m.lpFeeBps = lpFeeBps;
        m.protocolFeeBps = protocolFeeBps;
        m.maxStaleness = staleness;
        m.settlementDelay = settlementDelay;
        m.resolutionWindow = resolutionWindow;
        m.disputeWindow = disputeWindow;
        m.openTime = uint64(block.timestamp);
        m.tradingEndsAt = tradingEndsAt;
        m.closeTime = closeTime;
        m.creator = msg.sender;
        m.metadataHash = metadataHash;
    }

    function _emitCreated(uint256 id, Market storage m) internal {
        emit MarketCreated(
            id,
            m.kind,
            m.creator,
            m.assetA,
            m.assetB,
            m.openPriceA,
            m.openPriceB,
            m.openTime,
            m.tradingEndsAt,
            m.closeTime,
            m.metadataHash
        );
        emit MarketParams(
            id,
            m.feedA,
            m.feedB,
            m.openRoundA,
            m.openRoundB,
            m.maxStaleness,
            m.settlementDelay,
            m.resolutionWindow,
            m.disputeWindow,
            m.lpFeeBps,
            m.protocolFeeBps
        );
    }

    // ================================================================ trading

    /// @notice Buy YES (`isYes`) or NO shares with `amountIn` collateral.
    function buy(uint256 id, bool isYes, uint256 amountIn, uint256 minSharesOut, uint256 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _checkDeadline(deadline);
        Market storage m = _market(id);
        _requireTrading(m);
        _requireEligible(msg.sender);
        if (amountIn == 0) revert ZeroAmount();
        if (m.poolYes == 0 || m.poolNo == 0) revert NoLiquidity();

        uint256 fee = _fee(m, amountIn);
        uint256 net = amountIn - fee;
        if (net == 0) revert ZeroAmount();
        shares = FPMMMath.calcBuy(m.poolYes, m.poolNo, net, isYes);
        if (shares == 0 || shares < minSharesOut) revert Slippage();

        if (isYes) {
            m.poolYes = m.poolYes + net - shares;
            m.poolNo = m.poolNo + net;
        } else {
            m.poolNo = m.poolNo + net - shares;
            m.poolYes = m.poolYes + net;
        }
        m.collateral += net;
        _distributeFee(m, fee);

        collateralToken.safeTransferFrom(msg.sender, address(this), amountIn);
        _mint(msg.sender, _tokenId(id, isYes), shares, "");
        emit Trade(id, msg.sender, isYes, true, amountIn, shares, fee, m.poolYes, m.poolNo);
    }

    /// @notice Sell exactly `shares` YES/NO shares back to the pool (early exit / close position).
    function sell(uint256 id, bool isYes, uint256 shares, uint256 minAmountOut, uint256 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 amountOut)
    {
        _checkDeadline(deadline);
        Market storage m = _market(id);
        _requireTrading(m);
        if (shares == 0) revert ZeroAmount();
        if (m.poolYes == 0 || m.poolNo == 0) revert NoLiquidity();

        uint256 gross = FPMMMath.calcSell(m.poolYes, m.poolNo, shares, isYes);
        if (gross == 0) revert ZeroAmount();
        uint256 fee = _fee(m, gross);
        amountOut = gross - fee;
        if (amountOut < minAmountOut || amountOut == 0) revert Slippage();

        _burn(msg.sender, _tokenId(id, isYes), shares);
        if (isYes) {
            m.poolYes = m.poolYes + shares - gross;
            m.poolNo = m.poolNo - gross;
        } else {
            m.poolNo = m.poolNo + shares - gross;
            m.poolYes = m.poolYes - gross;
        }
        m.collateral -= gross;
        _distributeFee(m, fee);

        collateralToken.safeTransfer(msg.sender, amountOut);
        emit Trade(id, msg.sender, isYes, false, amountOut, shares, fee, m.poolYes, m.poolNo);
    }

    /// @notice Mint `amount` YES + `amount` NO for `amount` collateral (no fee).
    function splitPosition(uint256 id, uint256 amount) external whenNotPaused nonReentrant {
        Market storage m = _market(id);
        _requireTrading(m);
        _requireEligible(msg.sender);
        if (amount == 0) revert ZeroAmount();
        m.collateral += amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, _tokenId(id, true), amount, "");
        _mint(msg.sender, _tokenId(id, false), amount, "");
        emit PositionsSplit(id, msg.sender, amount);
    }

    /// @notice Burn `amount` YES + `amount` NO for `amount` collateral. Always available before resolution.
    function mergePositions(uint256 id, uint256 amount) external nonReentrant {
        Market storage m = _market(id);
        if (m.status == Status.RESOLVED) revert WrongStatus();
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, _tokenId(id, true), amount);
        _burn(msg.sender, _tokenId(id, false), amount);
        m.collateral -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit PositionsMerged(id, msg.sender, amount);
    }

    // ================================================================ liquidity

    function addLiquidity(uint256 id, uint256 amount, uint256 minLpShares, uint256 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 minted)
    {
        _checkDeadline(deadline);
        Market storage m = _market(id);
        _requireTrading(m);
        _requireEligible(msg.sender);
        minted = _addLiquidity(id, m, msg.sender, amount, false);
        if (minted < minLpShares) revert Slippage();
    }

    /// @notice Withdraw liquidity. Always permitted (proportional, cannot harm other LPs or traders).
    ///         Matched YES/NO pairs are merged into collateral; after resolution the shares are redeemed.
    function removeLiquidity(uint256 id, uint256 shares, uint256 minCollateralOut)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        Market storage m = _market(id);
        if (shares == 0) revert ZeroAmount();
        uint256 userShares = lpShares[id][msg.sender];
        if (shares > userShares) revert InvalidParams();

        _harvest(id, m, msg.sender);
        uint256 total = m.totalLpShares;
        uint256 yesAmt = Math.mulDiv(m.poolYes, shares, total);
        uint256 noAmt = Math.mulDiv(m.poolNo, shares, total);
        m.poolYes -= yesAmt;
        m.poolNo -= noAmt;
        m.totalLpShares = total - shares;
        lpShares[id][msg.sender] = userShares - shares;
        _feeDebt[id][msg.sender] = Math.mulDiv(userShares - shares, m.lpFeeAccPerShare, ACC_PRECISION);

        uint256 feesOut = _takeFees(id, m, msg.sender);

        uint256 yesLeft;
        uint256 noLeft;
        if (m.status == Status.RESOLVED) {
            collateralOut = _payout(m.outcome, yesAmt, noAmt);
        } else {
            collateralOut = yesAmt < noAmt ? yesAmt : noAmt;
            yesLeft = yesAmt - collateralOut;
            noLeft = noAmt - collateralOut;
        }
        if (collateralOut < minCollateralOut) revert Slippage();
        m.collateral -= collateralOut;

        uint256 transferOut = collateralOut + feesOut;
        if (transferOut > 0) collateralToken.safeTransfer(msg.sender, transferOut);
        if (yesLeft > 0) _mint(msg.sender, _tokenId(id, true), yesLeft, "");
        if (noLeft > 0) _mint(msg.sender, _tokenId(id, false), noLeft, "");
        emit LiquidityRemoved(id, msg.sender, shares, yesAmt, noAmt, collateralOut, feesOut);
    }

    function claimLpFees(uint256 id) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(id);
        _harvest(id, m, msg.sender);
        amount = _takeFees(id, m, msg.sender);
        if (amount == 0) revert ZeroAmount();
        collateralToken.safeTransfer(msg.sender, amount);
        emit LpFeesClaimed(id, msg.sender, amount);
    }

    function _addLiquidity(uint256 id, Market storage m, address provider, uint256 amount, bool initial)
        internal
        returns (uint256 minted)
    {
        if (amount == 0) revert ZeroAmount();
        if (initial && amount < minInitialLiquidity) revert InsufficientInitialLiquidity();

        _harvest(id, m, provider);
        uint256 yesBack;
        uint256 noBack;
        uint256 total = m.totalLpShares;
        if (total == 0) {
            if (amount < minInitialLiquidity) revert InsufficientInitialLiquidity();
            minted = amount;
            m.poolYes += amount;
            m.poolNo += amount;
        } else {
            uint256 y = m.poolYes;
            uint256 n = m.poolNo;
            uint256 weight = y > n ? y : n;
            uint256 keepYes = Math.mulDiv(amount, y, weight);
            uint256 keepNo = Math.mulDiv(amount, n, weight);
            yesBack = amount - keepYes;
            noBack = amount - keepNo;
            minted = Math.mulDiv(amount, total, weight);
            if (minted == 0) revert ZeroAmount();
            m.poolYes = y + keepYes;
            m.poolNo = n + keepNo;
        }
        m.totalLpShares = total + minted;
        m.collateral += amount;
        uint256 newShares = lpShares[id][provider] + minted;
        lpShares[id][provider] = newShares;
        _feeDebt[id][provider] = Math.mulDiv(newShares, m.lpFeeAccPerShare, ACC_PRECISION);

        collateralToken.safeTransferFrom(provider, address(this), amount);
        if (yesBack > 0) _mint(provider, _tokenId(id, true), yesBack, "");
        if (noBack > 0) _mint(provider, _tokenId(id, false), noBack, "");
        emit LiquidityAdded(id, provider, amount, minted, yesBack, noBack);
    }

    function _harvest(uint256 id, Market storage m, address provider) internal {
        uint256 shares = lpShares[id][provider];
        if (shares == 0) return;
        uint256 accrued = Math.mulDiv(shares, m.lpFeeAccPerShare, ACC_PRECISION);
        uint256 debt = _feeDebt[id][provider];
        if (accrued > debt) _pendingFees[id][provider] += accrued - debt;
        _feeDebt[id][provider] = accrued;
    }

    /// @dev Pays out pending fees, capped by the market's reserve so rounding can never touch collateral.
    function _takeFees(uint256 id, Market storage m, address provider) internal returns (uint256 amount) {
        amount = _pendingFees[id][provider];
        if (amount == 0) return 0;
        if (amount > m.lpFeeReserve) amount = m.lpFeeReserve;
        _pendingFees[id][provider] = 0;
        m.lpFeeReserve -= amount;
        lpFeesOutstanding -= amount;
    }

    // ================================================================ settlement

    /// @notice Resolve an UP_DOWN or BATTLE market with the feed round(s) in effect at `closeTime`.
    ///         Permissionless: the contract verifies the proof. For UP_DOWN pass roundB = nextRoundB = 0.
    function resolve(uint256 id, uint80 roundA, uint80 nextRoundA, uint80 roundB, uint80 nextRoundB)
        external
        whenNotPaused
        nonReentrant
    {
        Market storage m = _market(id);
        if (m.kind == Kind.EVENT) revert WrongKind();
        if (m.status != Status.OPEN) revert WrongStatus();
        if (block.timestamp < uint256(m.closeTime) + m.settlementDelay) revert TooEarly();
        if (block.timestamp > uint256(m.closeTime) + m.resolutionWindow) revert TooLate();

        (int256 closeA,) = oracle.priceAt(m.feedA, roundA, nextRoundA, m.closeTime, m.maxStaleness);
        Outcome outcome;
        int256 closeB;
        if (m.kind == Kind.UP_DOWN) {
            outcome = closeA > m.openPriceA ? Outcome.YES : (closeA < m.openPriceA ? Outcome.NO : Outcome.PUSH);
        } else {
            (closeB,) = oracle.priceAt(m.feedB, roundB, nextRoundB, m.closeTime, m.maxStaleness);
            // Compare (closeA/openA) vs (closeB/openB) exactly: closeA*openB vs closeB*openA (all > 0).
            int256 lhs = closeA * m.openPriceB;
            int256 rhs = closeB * m.openPriceA;
            outcome = lhs > rhs ? Outcome.YES : (lhs < rhs ? Outcome.NO : Outcome.PUSH);
        }
        m.closePriceA = closeA;
        m.closePriceB = closeB;
        m.status = Status.RESOLVED;
        m.outcome = outcome;
        emit MarketResolved(id, outcome, closeA, closeB, roundA, roundB);
    }

    /// @notice Fallback: after the resolution window with no valid settlement, anyone may invalidate.
    ///         INVALID pays 0.5 per YES and per NO share. Not blocked by pause so funds can never be locked.
    function resolveInvalid(uint256 id) external nonReentrant {
        Market storage m = _market(id);
        if (m.status != Status.OPEN) revert WrongStatus();
        if (block.timestamp <= uint256(m.closeTime) + m.resolutionWindow) revert TooEarly();
        m.status = Status.RESOLVED;
        m.outcome = Outcome.INVALID;
        emit MarketInvalidated(id, msg.sender, "resolution window elapsed");
        emit MarketResolved(id, Outcome.INVALID, 0, 0, 0, 0);
    }

    /// @notice Event markets: resolver proposes the outcome after `closeTime`.
    function proposeOutcome(uint256 id, Outcome outcome, string calldata evidenceURI)
        external
        whenNotPaused
        onlyRole(RESOLVER_ROLE)
    {
        Market storage m = _market(id);
        if (m.kind != Kind.EVENT) revert WrongKind();
        if (m.status != Status.OPEN) revert WrongStatus();
        if (block.timestamp < m.closeTime) revert TooEarly();
        if (block.timestamp > uint256(m.closeTime) + m.resolutionWindow) revert TooLate();
        if (outcome != Outcome.YES && outcome != Outcome.NO && outcome != Outcome.INVALID) revert InvalidParams();
        if (bytes(evidenceURI).length == 0) revert InvalidParams();
        m.status = Status.PROPOSED;
        m.proposedOutcome = outcome;
        m.proposedAt = uint64(block.timestamp);
        emit OutcomeProposed(id, outcome, msg.sender, evidenceURI);
    }

    /// @notice Guardian may reject a proposal during the dispute window (publicly, with a reason).
    function rejectProposal(uint256 id, string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _market(id);
        if (m.status != Status.PROPOSED) revert WrongStatus();
        if (block.timestamp >= uint256(m.proposedAt) + m.disputeWindow) revert TooLate();
        m.status = Status.OPEN;
        m.proposedOutcome = Outcome.NONE;
        m.proposedAt = 0;
        emit ProposalRejected(id, msg.sender, reason);
    }

    /// @notice Anyone finalizes an undisputed proposal after the dispute window.
    function finalizeOutcome(uint256 id) external nonReentrant {
        Market storage m = _market(id);
        if (m.status != Status.PROPOSED) revert WrongStatus();
        if (block.timestamp < uint256(m.proposedAt) + m.disputeWindow) revert TooEarly();
        m.status = Status.RESOLVED;
        m.outcome = m.proposedOutcome;
        emit MarketResolved(id, m.outcome, 0, 0, 0, 0);
    }

    /// @notice Emergency: guardian invalidates an unresolved market (e.g. compromised oracle). Publicly logged.
    function emergencyInvalidate(uint256 id, string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _market(id);
        if (m.status == Status.RESOLVED) revert WrongStatus();
        if (bytes(reason).length == 0) revert InvalidParams();
        m.status = Status.RESOLVED;
        m.outcome = Outcome.INVALID;
        emit MarketInvalidated(id, msg.sender, reason);
        emit MarketResolved(id, Outcome.INVALID, 0, 0, 0, 0);
    }

    /// @notice Redeem all of the caller's shares in a resolved market. Shares are burned (no double claims).
    function redeem(uint256 id) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(id);
        if (m.status != Status.RESOLVED) revert WrongStatus();
        uint256 yesId = _tokenId(id, true);
        uint256 noId = _tokenId(id, false);
        uint256 yesBal = balanceOf(msg.sender, yesId);
        uint256 noBal = balanceOf(msg.sender, noId);
        if (yesBal == 0 && noBal == 0) revert NothingToRedeem();
        if (yesBal > 0) _burn(msg.sender, yesId, yesBal);
        if (noBal > 0) _burn(msg.sender, noId, noBal);
        payout = _payout(m.outcome, yesBal, noBal);
        m.collateral -= payout;
        if (payout > 0) collateralToken.safeTransfer(msg.sender, payout);
        emit Redeemed(id, msg.sender, yesBal, noBal, payout);
    }

    function _payout(Outcome outcome, uint256 yesAmt, uint256 noAmt) internal pure returns (uint256) {
        if (outcome == Outcome.YES) return yesAmt;
        if (outcome == Outcome.NO) return noAmt;
        return (yesAmt + noAmt) / 2; // PUSH / INVALID
    }

    // ================================================================ AMM math

    function _fee(Market storage m, uint256 amount) internal view returns (uint256) {
        return FPMMMath.fee(amount, uint256(m.lpFeeBps) + m.protocolFeeBps);
    }

    function _distributeFee(Market storage m, uint256 fee) internal {
        if (fee == 0) return;
        uint256 bps = uint256(m.lpFeeBps) + m.protocolFeeBps;
        uint256 lpPart = Math.mulDiv(fee, m.lpFeeBps, bps);
        uint256 total = m.totalLpShares;
        if (total == 0 || lpPart == 0) {
            protocolFeesAccrued += fee;
            return;
        }
        uint256 accInc = Math.mulDiv(lpPart, ACC_PRECISION, total);
        // credit only what the accumulator can represent; rounding dust goes to the protocol
        uint256 credited = Math.mulDiv(accInc, total, ACC_PRECISION);
        m.lpFeeAccPerShare += accInc;
        m.lpFeeReserve += credited;
        lpFeesOutstanding += credited;
        protocolFeesAccrued += fee - credited;
    }

    // ================================================================ views

    function getMarket(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    function tokenId(uint256 id, bool isYes) external pure returns (uint256) {
        return _tokenId(id, isYes);
    }

    function pendingLpFees(uint256 id, address provider) external view returns (uint256) {
        Market storage m = _markets[id];
        uint256 accrued = Math.mulDiv(lpShares[id][provider], m.lpFeeAccPerShare, ACC_PRECISION);
        uint256 debt = _feeDebt[id][provider];
        return _pendingFees[id][provider] + (accrued > debt ? accrued - debt : 0);
    }

    function _tokenId(uint256 id, bool isYes) internal pure returns (uint256) {
        return isYes ? id * 2 : id * 2 + 1;
    }

    // ================================================================ admin (affects NEW markets only)

    function setFees(uint16 lpFeeBps_, uint16 protocolFeeBps_) external onlyRole(CONFIG_ROLE) {
        if (uint256(lpFeeBps_) + protocolFeeBps_ > MAX_TOTAL_FEE_BPS) revert InvalidParams();
        lpFeeBps = lpFeeBps_;
        protocolFeeBps = protocolFeeBps_;
        emit FeesUpdated(lpFeeBps_, protocolFeeBps_);
    }

    function setWindows(uint32 settlementDelay_, uint32 resolutionWindow_, uint32 disputeWindow_)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (settlementDelay_ > 1 days) revert InvalidParams();
        if (resolutionWindow_ < 1 days || resolutionWindow_ > 30 days) revert InvalidParams();
        if (resolutionWindow_ <= settlementDelay_) revert InvalidParams();
        if (disputeWindow_ < 1 hours || disputeWindow_ > 7 days) revert InvalidParams();
        settlementDelay = settlementDelay_;
        resolutionWindow = resolutionWindow_;
        disputeWindow = disputeWindow_;
        emit WindowsUpdated(settlementDelay_, resolutionWindow_, disputeWindow_);
    }

    function setDuration(uint32 duration, bool enabled, uint32 tradingCutoff) external onlyRole(CONFIG_ROLE) {
        if (duration < 1 minutes || duration > 90 days || tradingCutoff >= duration) revert InvalidParams();
        durations[duration] = DurationConfig(enabled, tradingCutoff);
        emit DurationUpdated(duration, enabled, tradingCutoff);
    }

    function setCreationPolicy(bool openCreation_, uint256 minInitialLiquidity_) external onlyRole(CONFIG_ROLE) {
        if (minInitialLiquidity_ == 0) revert InvalidParams();
        openCreation = openCreation_;
        minInitialLiquidity = minInitialLiquidity_;
        emit CreationPolicyUpdated(openCreation_, minInitialLiquidity_);
    }

    function setEligibilityRequired(bool required) external onlyRole(CONFIG_ROLE) {
        eligibilityRequired = required;
        emit EligibilityPolicyUpdated(required);
    }

    function setEligibility(address[] calldata accounts, bool eligible) external onlyRole(ELIGIBILITY_ROLE) {
        for (uint256 i; i < accounts.length; ++i) {
            isEligible[accounts[i]] = eligible;
            emit EligibilitySet(accounts[i], eligible);
        }
    }

    function setURI(string calldata newUri) external onlyRole(CONFIG_ROLE) {
        _setURI(newUri);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    function withdrawProtocolFees(address to) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidParams();
        uint256 amount = protocolFeesAccrued;
        if (amount == 0) revert ZeroAmount();
        protocolFeesAccrued = 0;
        collateralToken.safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    // ================================================================ overrides

    /// @dev When eligibility is enforced, shares can only be transferred to eligible accounts.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155Supply)
    {
        if (eligibilityRequired && from != address(0) && to != address(0) && !isEligible[to]) {
            revert NotEligible(to);
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
