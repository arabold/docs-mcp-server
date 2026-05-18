import { crossJudgeCli } from "../cross-judge";

crossJudgeCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
