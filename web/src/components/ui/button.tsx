import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background,color,transform,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-surface-2",
        ghost: "hover:bg-surface-2",
        subtle: "bg-surface-2 hover:bg-border",
        up: "bg-up text-white hover:opacity-90",
        down: "bg-down text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-6 text-lg",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
