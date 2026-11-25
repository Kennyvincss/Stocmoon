// Stub for optional x402 modules dynamically imported by @coinbase/cdp-sdk (via the Base Account wallet connector).
// StocMoon never calls x402 payment helpers; if anything ever does, fail loudly instead of silently.
const fail = (): never => {
  throw new Error("x402 payment modules are not bundled in StocMoon");
};
export const x402Client = fail;
export const registerExactEvmScheme = fail;
export const registerUptoEvmScheme = fail;
export const registerExactSvmScheme = fail;
export const ExactEvmScheme = fail;
export const UptoEvmScheme = fail;
export const ExactSvmScheme = fail;
export const UptoSvmScheme = fail;
export const ExactEvmSchemeV1 = fail;
export const ExactSvmSchemeV1 = fail;
export const AuthCaptureEvmScheme = fail;
export const BatchSettlementEvmScheme = fail;
export const toClientEvmSigner = fail;
export const toClientSvmSigner = fail;
export const x402ResourceServer = fail;
export const x402HTTPResourceServer = fail;
const stub = {};
export default stub;
