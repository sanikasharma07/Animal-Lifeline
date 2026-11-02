import {Router} from 'express';
import { createCampaign , getActiveCampaigns , processDonation , deleteCampaign ,uploadCampaignImpact , verifyDonation  , razorpayWebhook} from '../Controllers/donationcontroller.js'
import { verifyJWT , isNgo } from '../middlewares/authmiddleware.js';
import { upload } from '../middlewares/multermiddleware.js';

const donationrouter = Router();

donationrouter.route("/campaigns").post(verifyJWT, isNgo, createCampaign);
donationrouter.route("/campaigns/:id").delete(verifyJWT, isNgo, deleteCampaign);

// NEW: Upload Impact Proof (Requires photos)
donationrouter.route("/campaigns/:id/impact").post(
    verifyJWT, 
    isNgo, 
    upload.array("photos", 3), // Max 3 photos
    uploadCampaignImpact
);
// User/Public Routes
donationrouter.route("/campaigns").get(verifyJWT, getActiveCampaigns);
donationrouter.route("/campaigns/:id/donate").post(verifyJWT, processDonation);
donationrouter.route("/campaigns/:id/verify").post(verifyJWT, verifyDonation);
donationrouter.route("/webhook").post(razorpayWebhook);

export default donationrouter;