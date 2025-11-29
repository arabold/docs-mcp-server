import type { LibraryInfo } from "../../tools/ListLibrariesTool";
import Alert from "./Alert";
import LibraryItem from "./LibraryItem";

/**
 * Props for the LibraryList component.
 */
interface LibraryListProps {
  libraries: LibraryInfo[];
}

/**
 * Renders a list of LibraryItem components.
 * @param props - Component props including the array of libraries.
 */
const LibraryList = ({ libraries }: LibraryListProps) => {
  if (libraries.length === 0) {
    return (
      <Alert
        type="info"
        title="Welcome!"
        message={
          <>
            To get started, click{" "}
            <span class="font-semibold">Add New Documentation</span> above and
            enter the URL of a documentation site to index. For more
            information, check the{" "}
            <a
              href="https://grounded.tools"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline hover:no-underline"
            >
              official website
            </a>
            .
          </>
        }
      />
    );
  }

  return (
    <div
      id="library-list"
      class="space-y-2 animate-[fadeSlideIn_0.2s_ease-out]"
    >
      {libraries.map((library) => (
        <LibraryItem library={library} />
      ))}
    </div>
  );
};

export default LibraryList;
