/**
 * Typed tRPC React Query client bound to the server's merged `AppRouter`.
 * `AppRouter` is imported as a type-only import so no server code (or its
 * transitive dependencies, e.g. better-sqlite3) is ever bundled into the
 * browser build; the import is fully erased at compile time.
 */
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../services/appRouter";

/** React hooks (`trpc.<procedure>.useQuery`/`useMutation`/`useSubscription`) for the merged router. */
export const trpc = createTRPCReact<AppRouter>();
