import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";

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
// @desc    Get all vets pending verification
// @route   GET /api/v1/admin/vet/pending
export const getPendingVets = asyncHandler(async (req, res) => {
    const pendingVets = await Vet.find({ verificationStatus: "pending" })
        .populate("user", "name email phone");
    return res.status(200).json(
        new ApiResponse(200, pendingVets, "Pending vets fetched successfully")
    );
});

// @desc    Approve or Reject a vet
// @route   PATCH /api/v1/admin/vet/:id/verify
export const verifyVet = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status. Must be 'verified' or 'rejected'.");
    }

    const vet = await Vet.findById(id);
    if (!vet) {
        throw new ApiError(404, "Vet profile not found");
    }

    vet.verificationStatus = status;
    if (status === "verified") {
        vet.verifiedAt = new Date();
        vet.rejectionReason = undefined;
    } else if (status === "rejected") {
        if (!rejectionReason) {
            throw new ApiError(400, "A rejection reason is required when rejecting a vet.");
        }
        vet.rejectionReason = rejectionReason;
    }

    await vet.save();
    return res.status(200).json(
        new ApiResponse(200, vet, `Vet successfully marked as ${status}`)
    );
});
