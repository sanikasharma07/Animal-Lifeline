import { Ngo } from "../Models/ngomodel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// @desc    Get all NGOs pending verification
// @route   GET /api/v1/admin/ngos/pending
export const getPendingNgos = asyncHandler(async (req, res) => {
    const pendingNgos = await Ngo.find({ verificationStatus: "pending" })
        .populate("user", "name email phone"); // Pulls contact info from the User model

    return res.status(200).json(
        new ApiResponse(200, pendingNgos, "Pending NGOs fetched successfully")
    );
});

// @desc    Approve or Reject an NGO
// @route   PATCH /api/v1/admin/ngos/:id/verify
export const verifyNgo = asyncHandler(async (req, res ) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status. Must be 'verified' or 'rejected'.");
    }

    const ngo = await Ngo.findById(id);
    if (!ngo) {
        throw new ApiError(404, "NGO Profile not found");
    }

    ngo.verificationStatus = status;
    
    if (status === "verified") {
        ngo.verifiedAt = new Date();
        ngo.rejectionReason = undefined; // Clear any old rejection reasons
    } else if (status === "rejected") {
        if (!rejectionReason) {
            throw new ApiError(400, "A rejection reason is required when rejecting an NGO.");
        }
        ngo.rejectionReason = rejectionReason;
    }

    await ngo.save();

    return res.status(200).json(
        new ApiResponse(200, ngo, `NGO successfully marked as ${status}`)
    );
});