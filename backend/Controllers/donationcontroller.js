import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {Ngo} from "../Models/ngomodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";


// @desc    Create a Fundraising Campaign (NGO Only)
// @route   POST /api/v1/donations/campaigns
export const createCampaign = asyncHandler(async (req, res) => {
    const { title, description, targetAmount } = req.body;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can create fundraising campaigns.");
    }

    const campaign = await DonationCampaign.create({
        ngo: ngoProfile._id,
        title,
        description,
        targetAmount
    });

    return res.status(201).json(new ApiResponse(201, campaign, "Fundraising campaign launched!"));
});

// @desc    Get all active campaigns
// @route   GET /api/v1/donations/campaigns
export const getActiveCampaigns = asyncHandler(async (req, res) => {
    const campaigns = await DonationCampaign.find({ status: "Active" })
        .populate("ngo", "organizationName")
        .sort({ createdAt: -1 });

    return res.status(200).json(new ApiResponse(200, campaigns, "Active campaigns fetched."));
});

// @desc    Simulate a successful donation (User)
// @route   POST /api/v1/donations/campaigns/:id/donate
export const processDonation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 50) {
        throw new ApiError(400, "Donation amount must be greater than 50.");
    }

    const campaign = await DonationCampaign.findById(id);
    if (!campaign || campaign.status === "Closed") {
        throw new ApiError(404, "Campaign not found or closed.");
    }

})
// @desc    Delete a Fundraising Campaign
// @route   DELETE /api/v1/donations/campaigns/:id
export const deleteCampaign = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }

    const campaign = await DonationCampaign.findById(id);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }

    // Security 1: Only the NGO that created it can delete it
    if (String(campaign.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only delete your own campaigns.");
    }

    // Security 2: Financial Safeguard
    if (campaign.raisedAmount > 0) {
        throw new ApiError(
            400, 
            "Cannot delete a campaign that has already received donations. Please update the status to 'Closed' instead to keep financial records."
        );
    }

    await campaign.deleteOne();

    return res.status(200).json(
        new ApiResponse(200, null, "Campaign deleted successfully.")
    );
});

// @desc    Upload Impact Proof for a completed campaign
// @route   POST /api/v1/donations/campaigns/:id/impact
export const uploadCampaignImpact = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    const campaign = await DonationCampaign.findById(id);

    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }

    if (String(campaign.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only upload impact proof for your own campaigns.");
    }

    if (campaign.raisedAmount === 0) {
        throw new ApiError(400, "You cannot upload impact proof for a campaign that hasn't raised any money.");
    }

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) mediaUrls.push(uploaded.url);
        }
    }

    if (mediaUrls.length === 0) {
        throw new ApiError(400, "Please upload at least one photo (e.g., vet bill or recovered animal).");
    }

    campaign.impact = {
        photos: mediaUrls,
        message,
        uploadedAt: Date.now()
    };
    
  
  
    await campaign.save();

    return res.status(200).json(
        new ApiResponse(200, campaign, "Financial impact proof uploaded successfully!")
    );
});