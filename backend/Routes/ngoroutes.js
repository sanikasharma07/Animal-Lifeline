import { Router } from "express";
import { createorupdateNgoProfile } from "../Controllers/ngocontrollerl.js";
import { isNgo, verifyJWT} from "../middlewares/authmiddleware.js"
import { upload } from "../middlewares/multermiddleware.js";

const Ngorouter= Router();
//"For every route defined after this line in NgoRouter, first make sure the user is logged in, and then make sure they're an NGO."
Ngorouter.use(verifyJWT , isNgo);

Ngorouter.route("/profile").post(
    upload.fields([
        {name: "registrationCertificate" , maxCount: 1},
        {name: "panCard" , maxCount: 1},
        {name: "twelveACertificate" , maxCount: 1},
        {name: "eightyGCertificate" , maxCount: 1},
    ]),
    createorupdateNgoProfile
);

export default Ngorouter;