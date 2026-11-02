import { Router } from "express";
import { createVetProfile, updateVetProfile, getMyVetProfile, getVerifiedVets, getNearbyVets } from "../Controllers/vetcontroller.js";
import { verifyJWT, isVet } from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const vetRouter = Router();

const vetDocuments = upload.fields([
    { name: "licenseCertificate", maxCount: 1 },
    { name: "degreeCertificate", maxCount: 1 },
]);

// Create is open to any logged-in user (they become a vet by creating);
// update is vet-only, because only an existing vet has a profile to edit.
vetRouter.route("/profile").post(verifyJWT, vetDocuments, createVetProfile);
vetRouter.route("/profile").patch(verifyJWT, isVet, vetDocuments, updateVetProfile);
vetRouter.route("/profile").get(verifyJWT, getMyVetProfile);
vetRouter.route("/verified").get(verifyJWT, getVerifiedVets);
vetRouter.route("/nearby").get(verifyJWT, getNearbyVets);

export default vetRouter;
