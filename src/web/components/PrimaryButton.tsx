import type { PropsWithChildren } from "@kitajs/html";

/**
 * Props for the PrimaryButton component.
 */
interface PrimaryButtonProps extends PropsWithChildren {
  type?: "button" | "submit" | "reset";
  class?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

/**
 * A reusable primary button component with consistent styling.
 * Supports additional HTML attributes via spread.
 */
const PrimaryButton = ({
  children,
  type = "button",
  class: className = "",
  disabled = false,
  ...rest
}: PrimaryButtonProps) => {
  const baseClasses =
    "w-full flex justify-center py-1.5 px-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-150";
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "";
  const combinedClasses =
    `${baseClasses} ${disabledClasses} ${className}`.trim();

  return (
    <button type={type} class={combinedClasses} disabled={disabled} {...rest}>
      {children}
    </button>
  );
};

export default PrimaryButton;
