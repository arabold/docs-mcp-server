import type { LibraryInfo } from "../../tools/ListLibrariesTool";
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
