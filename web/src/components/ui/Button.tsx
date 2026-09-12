import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * DESIGN.md section 4. Depth comes from layered inset rings plus soft outer shadows, never
 * from a solid border or a single drop shadow. Both variants are 40px tall, which is also
 * the minimum touch target the design system specifies.
 */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  children: ReactNode;
}

const base =
  "inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-body font-medium " +
  "transition-[transform,filter,box-shadow] duration-150 ease-out " +
  "disabled:pointer-events-none disabled:opacity-40";

const primary =
  "bg-gradient-to-b from-[#3A3A3A] to-[#353535] text-white " +
  "[text-shadow:0_0.5px_0_rgb(0_0_0/0.5)] " +
  "shadow-[0_0.5px_1px_rgb(0_0_0/0.08),0_1px_3px_rgb(0_0_0/0.1),0_4px_12px_rgb(0_0_0/0.08),inset_0_0_0_1.25px_#353535,inset_0_0_12px_rgb(255_255_255/0.1)] " +
  "hover:brightness-110 active:scale-[0.98]";

const secondary =
  "bg-transparent text-ink-alt " +
  "shadow-[0_0.5px_1px_rgb(0_0_0/0.04),0_1px_3px_rgb(0_0_0/0.06),0_4px_12px_rgb(0_0_0/0.04),inset_0_0_0_1.25px_var(--color-control-ring),inset_0_0_12px_rgb(255_255_255/1)] " +
  "hover:brightness-[0.98] active:scale-[0.98]";

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  const classes = [base, variant === "primary" ? primary : secondary, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
