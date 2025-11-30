import PrimaryButton from "./PrimaryButton";

/**
 * Props for the AddVersionButton component.
 */
interface AddVersionButtonProps {
  libraryName: string;
}

/**
 * A reusable button component for adding a new version to a library.
 * Encapsulates both styling and HTMX behavior.
 */
const AddVersionButton = ({ libraryName }: AddVersionButtonProps) => {
  return (
    <PrimaryButton
      hx-get={`/web/libraries/${encodeURIComponent(libraryName)}/add-version-form`}
      hx-target="#add-version-form-container"
      hx-swap="innerHTML"
    >
      Add New Version
    </PrimaryButton>
  );
};

export default AddVersionButton;
