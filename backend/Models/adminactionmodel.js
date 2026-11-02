import mongoose from "mongoose";

// Immutable audit history for admin moderation. AdminAction documents
// are never edited or deleted through the API: a reversal (for example,
// lifting a suspension or restoring removed content) is a NEW AdminAction
// document, so both the original action and its reversal stay on record.
const adminActionSchema = new mongoose.Schema({
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    actionType: {
        type: String,
        required: true,
        enum: [
            "Warning",
            "Warning Revoked",
            "Temporary Suspension",
            "Indefinite Suspension",
            "Suspension Lifted",
            "Campaign Removal",
            "Campaign Restored",
            "Content Removal",
            "Content Restored",
            "Escalation",
        ],
    },
    targetType: {
        type: String,
        required: true,
        enum: ["User", "Ngo", "Vet", "DonationCampaign", "SupplyRequest", "EmergencyCase", "Animal", "VolunteerRequest", "VolunteerStory"],
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: "targetType",
    },
    // The report that led to this action, when the action is report-driven.
    reportId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Report",
    },
    reason: { type: String, required: true },
    details: String,
}, { timestamps: true });

adminActionSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminActionSchema.index({ admin: 1, createdAt: -1 });
export const AdminAction = mongoose.model("AdminAction", adminActionSchema);
