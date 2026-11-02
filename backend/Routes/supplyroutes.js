import { Router } from "express";
import { pledgeSupply, createSupplyRequest, updatePledgeStatus, cancelPledge, uploadImpact } from "../Controllers/supplycontroller.js";
import { verifyJWT, isNgo } from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const supplyrouter = Router();

// NGO Routes
supplyrouter.route("/").post(verifyJWT, isNgo, createSupplyRequest);
supplyrouter.route("/:requestId/pledge/:pledgeId/status").patch(verifyJWT, isNgo, updatePledgeStatus);
supplyrouter.route("/:id/impact").post(verifyJWT, isNgo, upload.array("photos", 3), uploadImpact);

// User Routes
supplyrouter.route("/:id/pledge").post(verifyJWT, pledgeSupply);
supplyrouter.route("/:requestId/pledge/:pledgeId/cancel").patch(verifyJWT, cancelPledge);

export default supplyrouter;