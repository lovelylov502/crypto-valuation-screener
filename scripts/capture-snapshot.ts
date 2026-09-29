// Manual and scheduled captures use the same publication gate and permanent journal.
process.argv[2] = "collect";
import("./publication-job");
