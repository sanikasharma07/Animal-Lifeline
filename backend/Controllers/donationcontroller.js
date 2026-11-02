import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Ngo } from "../Models/ngomodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";
import Razorpay from "razorpay";

// Initialize Razorpay Instance
const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

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

// @desc    Initiate a donation (Creates Razorpay Order)
// @route   POST /api/v1/donations/campaigns/:id/donate
export const processDonation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body; // Expecting amount in INR

    if (!amount || amount < 50) {
        throw new ApiError(400, "Donation amount must be at least ₹50.");
    }

    const campaign = await DonationCampaign.findById(id);
    if (!campaign || campaign.status === "Closed") {
        throw new ApiError(404, "Campaign not found or closed.");
    }

    // Create Razorpay Order options
    const options = {
        amount: Math.round(amount * 100), // Convert INR to paisa
        currency: 'INR',
        receipt: `receipt_campaign_${campaign._id}_${Date.now()}`
    };

    // Generate order via Razorpay
    const order = await razorpayInstance.orders.create(options);
    if (!order) {
        throw new ApiError(500, "Failed to generate Razorpay order.");
    }

    return res.status(200).json(
        new ApiResponse(200, { order, campaignId: campaign._id }, "Donation initiated successfully.")
    );
});

// @desc    Verify Razorpay Payment and Update Campaign Funds
// @route   POST /api/v1/donations/verify
export const verifyDonation = asyncHandler(async (req, res) => {
    const { razorpay_order_id, campaignId, isCancelled } = req.body;
    
    // Handle user cancelling the payment window
    if (isCancelled) {
        throw new ApiError(400, "Donation payment was cancelled.");
    }

    // Fetch actual payment status directly from Razorpay for security
    const orderinfo = await razorpayInstance.orders.fetch(razorpay_order_id);
    
    if (orderinfo.status === 'paid') {
        const campaign = await DonationCampaign.findById(campaignId);
        if (!campaign) {
            throw new ApiError(404, "Campaign not found.");
        }

        // Add the donation amount to the campaign (converting paisa back to INR)
        const donationAmount = orderinfo.amount / 100;
        campaign.raisedAmount = (campaign.raisedAmount || 0) + donationAmount;

        // Automatically close campaign if target is met or exceeded
        if (campaign.raisedAmount >= campaign.targetAmount) {
            campaign.status = "Closed";
        }

        await campaign.save();

        return res.status(200).json(
            new ApiResponse(200, campaign, `Thank you! ₹${donationAmount} donated successfully.`)
        );
    } else {
        throw new ApiError(400, "Payment verification failed.");
    }
});
// @desc    Razorpay Webhook (Safety net for payments)
// @route   POST /api/v1/donations/webhook
export const razorpayWebhook = asyncHandler(async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!webhookSecret || !signature) {
        throw new ApiError(400, "Webhook secret or signature missing.");
    }

    // 1. Verify the signature securely
    // Express already parsed req.body into JSON, so we stringify it back for crypto
    const bodyString = JSON.stringify(req.body);
    const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(bodyString)
        .digest("hex");

    if (expectedSignature !== signature) {
        throw new ApiError(400, "Invalid webhook signature.");
    }

    // 2. Process the event
    const event = req.body.event;

    if (event === "payment.captured") {
        const payment = req.body.payload.payment.entity;
        
        const razorpay_payment_id = payment.id;
        const razorpay_order_id = payment.order_id;
        const campaignId = payment.notes?.campaignId; // Grabbed from the notes we injected during creation!
        const userId = payment.notes?.userId;
        const amount = payment.amount / 100; // paise -> INR

        if (campaignId && userId) {
            // 3. Exact same idempotent logic as the frontend verify route
            // It will safely ignore the webhook if the frontend already recorded this exact transactionId.
            const updated = await DonationCampaign.findOneAndUpdate(
                { _id: campaignId, "donors.transactionId": { $ne: razorpay_payment_id } },
                {
                    $push: {
                        donors: {
                            user: userId,
                            amount,
                            transactionId: razorpay_payment_id,
                            orderId: razorpay_order_id,
                            donatedAt: new Date(),
                        },
                    },
                    $inc: { raisedAmount: amount },
                },
                { new: true }
            );

            // 4. Update status and impact if the webhook was the first to record the payment
            if (updated) {
                if (updated.status === "Active" && updated.raisedAmount >= updated.targetAmount) {
                    updated.status = "Goal Reached";
                    await updated.save();
                }

                const donationsByUser = updated.donors.filter((d) => String(d.user) === String(userId)).length;
                if (donationsByUser === 1) {
                    await User.findByIdAndUpdate(userId, { $inc: { "impact.campaignsFunded": 1 } });
                }
            }
        }
    }

    // Always return a 200 OK so Razorpay knows we received it and doesn't retry
    return res.status(200).send("Webhook received successfully.");
});

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

    if (String(campaign.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only delete your own campaigns.");
    }

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