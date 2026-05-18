import { aggregateCli } from "../aggregate";

aggregateCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
