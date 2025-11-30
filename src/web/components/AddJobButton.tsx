import PrimaryButton from "./PrimaryButton";

/**
 * A reusable button component for adding a new documentation job.
 * Encapsulates both styling and HTMX behavior.
 */
const AddJobButton = () => {
  return (
    <PrimaryButton
      hx-get="/web/jobs/new"
      hx-target="#addJobForm"
      hx-swap="innerHTML"
    >
      Add New Documentation
    </PrimaryButton>
  );
};

export default AddJobButton;
