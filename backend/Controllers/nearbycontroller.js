import { asyncHandler } from "../Utils/asynchandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";

// $geoNear returns the distance in metres, so this helper turns an
// aggregation result into the public Nearby Help shape: name, services,
// city/state, contact details (name, email, phone) and distance in km.
// Documents are never included: the aggregation projects only safe fields.
const shapeNgo = (doc) => ({
    type: "ngo",
    id: doc._id,
    name: doc.organizationName,
    services: doc.servicesProvided,
    animalsHandled: doc.animalsHandled,
    city: doc.address?.city,
    state: doc.address?.state,
    contact: doc.contact?.[0] ? { name: doc.contact[0].name, email: doc.contact[0].email, phone: doc.contact[0].phone } : null,
    distanceKm: Math.round((doc.distanceMeters / 1000) * 100) / 100,
});

const shapeVet = (doc) => ({
    type: "vet",
    id: doc._id,
    name: doc.clinicName,
    specialization: doc.specialization,
    qualifications: doc.qualifications,
    yearsExperience: doc.yearsExperience,
    services: doc.servicesProvided,
    city: doc.address?.city,
    state: doc.address?.state,
    contact: doc.contact?.[0] ? { name: doc.contact[0].name, email: doc.contact[0].email, phone: doc.contact[0].clinicPhone || doc.contact[0].phone } : null,
    distanceKm: Math.round((doc.distanceMeters / 1000) * 100) / 100,
});

// @desc    Public Nearby Help: verified NGOs + approved vets near a location,
//          with distance and contact details, no login required.
// @route   GET /api/v1/nearby/help?lng=&lat=&radiusKm=
// radiusKm defaults to 25 and is capped at 100. Only verified NGOs and
// approved vets with saved coordinates appear; pending/rejected ones never do.
export const getNearbyHelp = asyncHandler(async (req, res) => {
    const { lng, lat, radiusKm } = req.query;
    if (lng === undefined || lat === undefined) {
        throw new ApiError(400, "Longitude and latitude are required. Send ?lng= and ?lat= from device location or a manually entered location.");
    }
    const parsedLng = parseFloat(lng);
    const parsedLat = parseFloat(lat);
    if (!Number.isFinite(parsedLng) || !Number.isFinite(parsedLat)) {
        throw new ApiError(400, "Longitude and latitude must be numbers.");
    }
    if (parsedLng < -180 || parsedLng > 180 || parsedLat < -90 || parsedLat > 90) {
        throw new ApiError(400, "Longitude must be between -180 and 180 and latitude between -90 and 90.");
    }
    let radius = radiusKm === undefined ? 25 : parseFloat(radiusKm);
    if (!Number.isFinite(radius) || radius <= 0) {
        throw new ApiError(400, "radiusKm must be a number greater than 0.");
    }
    radius = Math.min(radius, 100);
    const maxDistance = radius * 1000;

    // $geoNear must be the first aggregation stage and needs the
    // 2dsphere index both models already have. It also sorts by distance.
    const ngoDocs = await Ngo.aggregate([
        { $geoNear: { near: { type: "Point", coordinates: [parsedLng, parsedLat] }, distanceField: "distanceMeters", maxDistance, spherical: true, query: { verificationStatus: "verified" } } },
        { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "contact" } },
    ]);
    const vetDocs = await Vet.aggregate([
        { $geoNear: { near: { type: "Point", coordinates: [parsedLng, parsedLat] }, distanceField: "distanceMeters", maxDistance, spherical: true, query: { verificationStatus: "verified" } } },
        { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "contact" } },
    ]);

    const ngos = ngoDocs.map(shapeNgo);
    const vets = vetDocs.map(shapeVet);
    return res.status(200).json(new ApiResponse(200, {
        ngos,
        vets,
        total: ngos.length + vets.length,
        radiusKm: radius,
    }, `Found ${ngos.length} NGOs and ${vets.length} vets within ${radius} km.`));
});
