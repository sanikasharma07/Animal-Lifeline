import { Router } from "express";
import { createorupdateNgoProfile , getVerifiedNgos , getNearbyNgos} from "../Controllers/ngocontrollerl.js";
import { isNgo, verifyJWT} from "../middlewares/authmiddleware.js"
import { upload } from "../middlewares/multermiddleware.js";
  

const Ngorouter= Router();
//"For every route defined after this line in NgoRouter, first make sure the user is logged in, and then make sure they're an NGO."
Ngorouter.use(verifyJWT);

Ngorouter.route("/profile").post(
    upload.fields([
        {name: "registrationCertificate" , maxCount: 1},
        {name: "panCard" , maxCount: 1},
        {name: "twelveACertificate" , maxCount: 1},
        {name: "eightyGCertificate" , maxCount: 1},
    ]),
    createorupdateNgoProfile
);

Ngorouter.route("/verified").get(getVerifiedNgos);
Ngorouter.route("/nearby").get(getNearbyNgos);

export default Ngorouter;