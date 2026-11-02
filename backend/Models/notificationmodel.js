import mongoose from "mongoose";

// In-app notifications only. No email, SMS, push or external service is
// involved: a notification is a database row for one recipient, read
// through the inbox API. Notifications are retained; Batch 5 has no
// automatic cleanup.
const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    type: {
        type: String,
        required: true,
        enum: [
            "EmergencyAccepted",
            "EmergencyStatus",
            "EmergencyUpdate",
            "EmergencyInfoRequest",
            "EmergencyUnableToRespond",
            "DonationSuccess",
            "DonationReceived",
            "CampaignGoalReached",
            "CampaignUpdate",
            "CampaignImpact",
            "SupplyPledgeStatus",
            "SupplyFulfilled",
            "VolunteerApplication",
            "VolunteerOpportunityClosed",
            "AdoptionApplication",
            "Verification",
            "ReportDecision",
            "ModerationWarning",
            "ModerationSuspension",
            "ModerationLifted",
            "ModerationRemoval",
            "ModerationRestored",
            "ModerationEscalation",
        ],
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    // The resource this notification is about, e.g. an EmergencyCase or
    // DonationCampaign. The frontend can use it to open the right screen.
    relatedType: {
        type: String,
        enum: ["EmergencyCase", "DonationCampaign", "SupplyRequest", "VolunteerRequest", "VolunteerApplication", "Animal", "AdoptionApplication", "Ngo", "Vet", "Report", "User"],
    },
    relatedId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "relatedType",
    },
    isRead: { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
export const Notification = mongoose.model("Notification", notificationSchema);
