import Alert from "./Alert";
import Tooltip from "./Tooltip";

interface PlaintextFormContentProps {
  // No specific props needed for now, but interface ready for future extensions
}

/**
 * Renders the form fields for adding plaintext content.
 * Includes fields for library, version, title, content, description, and tags.
 */
const PlaintextFormContent = ({}: PlaintextFormContentProps) => {
  return (
    <div class="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-300 dark:border-gray-600">
      <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Add Plaintext Content
      </h3>
      <form
        hx-post="/web/plaintext/add"
        hx-target="#plaintext-response"
        hx-swap="innerHTML"
        class="space-y-4"
        x-data="{
          content: '',
          tags: '',
          getContentLength() {
            return this.content.length;
          },
          getTagsArray() {
            return this.tags.split(',').filter(tag => tag.trim()).map(tag => tag.trim());
          }
        }"
      >
        {/* Library Name Field */}
        <div>
          <div class="flex items-center">
            <label
              for="library"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Library Name
            </label>
            <Tooltip text="The name of the library or project this content belongs to. This will be used when searching." />
          </div>
          <input
            type="text"
            name="library"
            id="library"
            required
            placeholder="e.g., my-project, api-docs"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Version Field */}
        <div>
          <div class="flex items-center">
            <label
              for="version"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Version (Optional)
            </label>
            <Tooltip text="The version of the library this content is for. Leave empty for unversioned content." />
          </div>
          <input
            type="text"
            name="version"
            id="version"
            placeholder="e.g., 1.0.0, 2.1.3, latest"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Title Field */}
        <div>
          <div class="flex items-center">
            <label
              for="title"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Title
            </label>
            <Tooltip text="A descriptive title for this content that will appear in search results." />
          </div>
          <input
            type="text"
            name="title"
            id="title"
            required
            placeholder="e.g., Getting Started Guide, API Reference"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Content Field */}
        <div>
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <label
                for="content"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Content
              </label>
              <Tooltip text="The plaintext content you want to add. This can be documentation, guides, or any textual information." />
            </div>
            <span 
              class="text-xs text-gray-500 dark:text-gray-400"
              x-text="`${getContentLength()} characters`"
            >
            </span>
          </div>
          <textarea
            name="content"
            id="content"
            required
            x-model="content"
            rows={12}
            placeholder="Enter your plaintext content here..."
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm resize-y"
          />
          <div class="mt-1">
            <Alert
              type="info"
              message="The content will be automatically processed, chunked, and indexed for search. Markdown formatting is supported."
            />
          </div>
        </div>

        {/* Description Field */}
        <div>
          <div class="flex items-center">
            <label
              for="description"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Description (Optional)
            </label>
            <Tooltip text="A brief description of what this content covers. This helps with search and organization." />
          </div>
          <input
            type="text"
            name="description"
            id="description"
            placeholder="e.g., Comprehensive guide for new users"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Tags Field */}
        <div>
          <div class="flex items-center">
            <label
              for="tags"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Tags (Optional)
            </label>
            <Tooltip text="Comma-separated tags to help categorize and find this content later." />
          </div>
          <input
            type="text"
            name="tags"
            id="tags"
            x-model="tags"
            placeholder="e.g., guide, tutorial, api, getting-started"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span x-text="`Tags: ${getTagsArray().join(', ') || 'none'}`"></span>
          </p>
        </div>

        {/* Submit Button */}
        <div class="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-600">
          <div class="text-sm text-gray-600 dark:text-gray-400">
            The content will be processed and made searchable immediately.
          </div>
          <button
            type="submit"
            class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Content
          </button>
        </div>
      </form>

      {/* Response container */}
      <div id="plaintext-response" class="mt-4"></div>
    </div>
  );
};

export default PlaintextFormContent;