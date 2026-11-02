import { Router } from "express";
import {
    getPendingNgos, verifyNgo, getPendingVets, verifyVet,
    getAdminReports, getAdminReportById, updateReportStatus,
    warnUser, revokeWarning, suspendUser, liftSuspension,
    removeCampaign, restoreCampaign, removeContent, restoreContent,
    escalateTarget, getAdminActions,
    getAdminUsers, getAdminCampaigns, getAdminEmergencies,
} from "../Controllers/admincontroller.js";
import { verifyJWT, isAdmin } from "../middlewares/authmiddleware.js";

const router = Router();

// Secure all admin routes
router.use(verifyJWT, isAdmin);

router.route("/ngo/pending").get(getPendingNgos);
router.route("/ngo/:id/verify").patch(verifyNgo);
router.route("/vet/pending").get(getPendingVets);
router.route("/vet/:id/verify").patch(verifyVet);

// Report investigation queue. "/reports" before "/reports/:id".
router.route("/reports").get(getAdminReports);
router.route("/reports/:id").get(getAdminReportById);
router.route("/reports/:id").patch(updateReportStatus);

// Moderation actions (each creates an immutable AdminAction record).
router.route("/moderation/warn").post(warnUser);
router.route("/moderation/revoke-warning").post(revokeWarning);
router.route("/moderation/suspend").post(suspendUser);
router.route("/moderation/lift-suspension").post(liftSuspension);
router.route("/moderation/remove-campaign").post(removeCampaign);
router.route("/moderation/restore-campaign").post(restoreCampaign);
router.route("/moderation/remove-content").post(removeContent);
router.route("/moderation/restore-content").post(restoreContent);
router.route("/moderation/escalate").post(escalateTarget);

// Audit history and monitoring lists.
router.route("/actions").get(getAdminActions);
router.route("/users").get(getAdminUsers);
router.route("/campaigns").get(getAdminCampaigns);
router.route("/emergencies").get(getAdminEmergencies);

export default router;
