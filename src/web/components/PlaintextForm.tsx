import PlaintextFormContent from "./PlaintextFormContent";

interface PlaintextFormProps {
  // No specific props needed for now, but interface ready for future extensions
}

/**
 * Wrapper component for the PlaintextFormContent.
 * Provides a container div, often used as a target for HTMX OOB swaps.
 */
const PlaintextForm = ({}: PlaintextFormProps) => (
  <div id="plaintext-form-container">
    <PlaintextFormContent />
  </div>
);

export default PlaintextForm;