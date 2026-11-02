import { Router } from "express";
import { pledgeSupply, createSupplyRequest, updatePledgeStatus, cancelPledge, uploadImpact, getOpenSupplyRequests, getMySupplyRequests, getSupplyRequestById } from "../Controllers/supplycontroller.js";
import { verifyJWT, isNgo } from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const supplyrouter = Router();

// Browsing routes ("/mine" before "/:id", otherwise "mine" is an id)
supplyrouter.route("/").get(verifyJWT, getOpenSupplyRequests);
supplyrouter.route("/mine").get(verifyJWT, isNgo, getMySupplyRequests);
supplyrouter.route("/:id").get(verifyJWT, getSupplyRequestById);

// NGO Routes
supplyrouter.route("/").post(verifyJWT, isNgo, createSupplyRequest);
supplyrouter.route("/:requestId/pledge/:pledgeId/status").patch(verifyJWT, isNgo, updatePledgeStatus);
supplyrouter.route("/:id/impact").post(verifyJWT, isNgo, upload.array("photos", 3), uploadImpact);

// User Routes
supplyrouter.route("/:id/pledge").post(verifyJWT, pledgeSupply);
supplyrouter.route("/:requestId/pledge/:pledgeId/cancel").patch(verifyJWT, cancelPledge);

export default supplyrouter;