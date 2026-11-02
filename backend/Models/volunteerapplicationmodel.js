import mongoose from "mongoose";

// One user's application to one volunteer opportunity. The ngo field is
// denormalized from the opportunity so an NGO can list "applications to
// my opportunities" with a single query, without joining opportunities.
const volunteerApplicationSchema = new mongoose.Schema({
    applicant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    opportunity: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VolunteerRequest",
        required: true,
    },
    ngo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ngo",
        required: true,
    },
    message: String,
    experience: String,
    status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected", "Completed"],
        default: "Pending",
    },
    // Hours the volunteer actually worked, recorded by the NGO when it
    // marks an Approved application Completed. Added to the volunteer's
    // impact.volunteerHours at that point (see volunteercontroller).
    hoursContributed: {
        type: Number,
        default: 0,
        min: 0,
    },
}, { timestamps: true });

// One application per user per opportunity: a second apply is a 400 in
// the controller, and this index makes that rule hold even under a race.
volunteerApplicationSchema.index({ applicant: 1, opportunity: 1 }, { unique: true });
export const VolunteerApplication = mongoose.model("VolunteerApplication", volunteerApplicationSchema);
