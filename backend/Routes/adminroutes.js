import { Router } from "express";
import { getPendingNgos, verifyNgo } from "../Controllers/admincontroller.js";
import { verifyJWT, isAdmin } from "../middlewares/authmiddleware.js";

const router = Router();

// Secure all admin routes
router.use(verifyJWT, isAdmin);

router.route("/ngo/pending").get(getPendingNgos);
router.route("/ngo/:id/verify").patch(verifyNgo);

export default router;