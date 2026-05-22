import { Router } from "express";
import { postVisualSearch, visualSearchUpload } from "../controllers/visualSearchController.js";
import { getCatalogSearch } from "../controllers/searchController.js";

const router = Router();

/** Text search — storefront catalogue (supplier metadata stripped in responses) */
router.get("/", getCatalogSearch);
router.post("/visual", visualSearchUpload, postVisualSearch);

export default router;
