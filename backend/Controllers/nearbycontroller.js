import { asyncHandler } from "../Utils/asynchandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";

// ---------------------------------------------------------------------------
// Shared distance helpers
// ---------------------------------------------------------------------------

// Round a distance in metres to kilometres with 2 decimals, or null when
// no usable distance exists. A null distance is never replaced with a guess:
// the listing is returned with the explicit "Distance unavailable" label.
const toDistanceKm = (distanceMeters) => {
    if (!Number.isFinite(distanceMeters)) return null;
    return Math.round((distanceMeters / 1000) * 100) / 100;
};

const distanceLabelFor = (distanceKm) =>
    distanceKm === null ? "Distance unavailable" : `${distanceKm.toFixed(2)} km`;

// Haversine distance in km between two lat/lng points. Returns null when
// either point is missing, so no distance is ever invented.
const haversineKm = (lat1, lng1, lat2, lng2) => {
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * earthRadiusKm * Math.asin(Math.sqrt(a)) * 100) / 100;
};

// GeoJSON coordinates are stored as [longitude, latitude]. Returns
// { latitude, longitude } or nulls when the document has no location.
const coordsOf = (doc) => {
    const coords = doc.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return { latitude: null, longitude: null };
    const [longitude, latitude] = coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return { latitude: null, longitude: null };
    }
    return { latitude, longitude };
};

// Sort by distance ascending; listings without a distance go last.
const sortByDistance = (listings) =>
    [...listings].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

// ---------------------------------------------------------------------------
// Registered (Animal Lifeline) listings
// ---------------------------------------------------------------------------
// $geoNear returns the distance in metres, so this helper turns an
// aggregation result into the public Nearby Help shape: name, services,
// city/state, contact details (name, email, phone) and distance in km.
// Documents are never included: the aggregation projects only safe fields.
// Registered entries are marked with source "animal_lifeline" and the
// "Verified on Animal Lifeline" status; that is what sets them apart from
// the external listings below, which must never carry either marker.
const shapeNgo = (doc) => {
    const { latitude, longitude } = coordsOf(doc);
    const distanceKm = toDistanceKm(doc.distanceMeters);
    return {
        type: "ngo",
        source: "animal_lifeline",
        registrationStatus: "Verified on Animal Lifeline",
        id: doc._id,
        name: doc.organizationName,
        services: doc.servicesProvided,
        animalsHandled: doc.animalsHandled,
        city: doc.address?.city,
        state: doc.address?.state,
        contact: doc.contact?.[0] ? { name: doc.contact[0].name, email: doc.contact[0].email, phone: doc.contact[0].phone } : null,
        latitude,
        longitude,
        distanceKm,
        distanceLabel: distanceLabelFor(distanceKm),
    };
};

const shapeVet = (doc) => {
    const { latitude, longitude } = coordsOf(doc);
    const distanceKm = toDistanceKm(doc.distanceMeters);
    return {
        type: "vet",
        source: "animal_lifeline",
        registrationStatus: "Verified on Animal Lifeline",
        id: doc._id,
        name: doc.clinicName,
        specialization: doc.specialization,
        qualifications: doc.qualifications,
        yearsExperience: doc.yearsExperience,
        services: doc.servicesProvided,
        city: doc.address?.city,
        state: doc.address?.state,
        contact: doc.contact?.[0] ? { name: doc.contact[0].name, email: doc.contact[0].email, phone: doc.clinicPhone || doc.contact[0].phone } : null,
        latitude,
        longitude,
        distanceKm,
        distanceLabel: distanceLabelFor(distanceKm),
    };
};

// ---------------------------------------------------------------------------
// External (OpenStreetMap / Overpass) listings
// ---------------------------------------------------------------------------
// External listings are read-only display data. They are NEVER written to
// MongoDB, never turned into Ngo/Vet documents and never given a platform
// account, so they cannot pass the verified-NGO gate in the emergency
// accept flow (which requires a real, verified Ngo profile). They are
// labelled by source "openstreetmap" and "Not registered on Animal
// Lifeline" everywhere they appear, and are kept in a separate group from
// the verified listings.
//
// OSM tagging is inconsistent, so the query asks for the tags that are
// unambiguously animal-related (veterinary, animal shelter, animal
// rescue) plus NGO/charity offices, which are then filtered to
// animal-related ones by name/description below. An NGO tagged only as
// office=ngo with no animal keyword in its name will not be found; that
// is a data limitation, not a code error, and it is reported as such.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OSM_TIMEOUT_MS = 15000;
const OSM_ATTRIBUTION =
    "© OpenStreetMap contributors, data available under the Open Database License (ODbL). External listings are not verified by Animal Lifeline.";

const ANIMAL_KEYWORD = /\b(animal|animals|dog|dogs|cat|cats|pet|pets|wildlife|rescue|shelter|veterinary|vet|vets|gaushala|goshala|paw|paws|stray|cattle|cow|bird|horse|adoption|foster)\b/i;

const categoryFor = (tags) => {
    if (tags.amenity === "veterinary") return "Veterinary clinic";
    if (tags.amenity === "animal_shelter") return "Animal shelter";
    if (tags.amenity === "animal_rescue") return "Animal rescue";
    return "Animal welfare organisation";
};

// An office=ngo / office=charity result is only animal-related when its
// name, description or operator mentions animals; veterinary, shelter
// and rescue tags are animal-related by definition and skip this check.
const isAnimalRelated = (tags) => {
    if (tags.amenity === "veterinary" || tags.amenity === "animal_shelter" || tags.amenity === "animal_rescue") return true;
    const text = [tags.name, tags.description, tags.operator].filter(Boolean).join(" ");
    return ANIMAL_KEYWORD.test(text);
};

const addressFor = (tags) => {
    if (tags["addr:full"]) return tags["addr:full"];
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const parts = [
        street || null,
        tags["addr:suburb"] || tags["addr:neighbourhood"] || null,
        tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || null,
        tags["addr:state"] || null,
        tags["addr:postcode"] || null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
};

const shapeOsmListing = (element, userLat, userLng) => {
    const tags = element.tags || {};
    const latitude = Number.isFinite(element.lat)
        ? element.lat
        : Number.isFinite(element.center?.lat)
            ? element.center.lat
            : null;
    const longitude = Number.isFinite(element.lon)
        ? element.lon
        : Number.isFinite(element.center?.lon)
            ? element.center.lon
            : null;
    const distanceKm =
        latitude !== null && longitude !== null
            ? haversineKm(userLat, userLng, latitude, longitude)
            : null;
    const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"] || null;
    const website = tags.website || tags["contact:website"] || null;
    const email = tags.email || tags["contact:email"] || null;
    return {
        type: "external",
        category: categoryFor(tags),
        source: "openstreetmap",
        registrationStatus: "Not registered on Animal Lifeline",
        id: `osm:${element.type}/${element.id}`,
        osmId: `${element.type}/${element.id}`,
        name: tags.name,
        address: addressFor(tags),
        city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || null,
        state: tags["addr:state"] || null,
        contact: phone || website || email ? { name: null, phone, website, email } : null,
        latitude,
        longitude,
        distanceKm,
        distanceLabel: distanceLabelFor(distanceKm),
    };
};

// Normalised name for duplicate matching: case, accents, punctuation and
// spacing are ignored, so "Paws Shelter" and "paws-shelter" match.
const normalizeName = (name) =>
    (name || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

// Two listings are the same place when they share a normalised name and
// are within 500 m of each other. The registered listing always wins and
// the external duplicate is dropped; a same-name branch further away is
// kept, because it may genuinely be a different branch.
const isDuplicateOf = (candidate, existing) => {
    if (!candidate.name || !existing.name) return false;
    if (normalizeName(candidate.name) !== normalizeName(existing.name)) return false;
    if (candidate.latitude === null || candidate.longitude === null) return false;
    if (existing.latitude === null || existing.longitude === null) return false;
    const distance = haversineKm(candidate.latitude, candidate.longitude, existing.latitude, existing.longitude);
    return distance !== null && distance <= 0.5;
};

// Fetches external listings from Overpass. Never throws: on any failure
// (timeout, network error, non-200 response, unexpected payload) it
// returns an empty list with status "unavailable", so the registered
// listings are still returned and the request still succeeds.
const fetchOsmListings = async (userLat, userLng, radiusMeters) => {
    const query = `
[out:json][timeout:15];
(
  node["amenity"="veterinary"](around:${radiusMeters},${userLat},${userLng});
  way["amenity"="veterinary"](around:${radiusMeters},${userLat},${userLng});
  node["amenity"="animal_shelter"](around:${radiusMeters},${userLat},${userLng});
  way["amenity"="animal_shelter"](around:${radiusMeters},${userLat},${userLng});
  node["amenity"="animal_rescue"](around:${radiusMeters},${userLat},${userLng});
  way["amenity"="animal_rescue"](around:${radiusMeters},${userLat},${userLng});
  node["office"="ngo"](around:${radiusMeters},${userLat},${userLng});
  way["office"="ngo"](around:${radiusMeters},${userLat},${userLng});
  node["office"="charity"](around:${radiusMeters},${userLat},${userLng});
  way["office"="charity"](around:${radiusMeters},${userLat},${userLng});
);
out center tags;
`.trim();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OSM_TIMEOUT_MS);
    try {
        const response = await fetch(OVERPASS_URL, {
            method: "POST",
            // Overpass requires an identifying User-Agent (its usage
            // policy asks applications to identify themselves); without
            // one the public instance rejects the request.
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "AnimalLifeline/1.0",
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
        });
        if (!response.ok) return { listings: [], status: "unavailable" };
        const data = await response.json();
        if (!data || !Array.isArray(data.elements)) return { listings: [], status: "unavailable" };
        const listings = [];
        for (const element of data.elements) {
            const tags = element.tags || {};
            if (!tags.name) continue; // A listing without a name cannot be displayed.
            if (!isAnimalRelated(tags)) continue;
            const listing = shapeOsmListing(element, userLat, userLng);
            // Drop duplicates of an earlier external listing (the same
            // place is often mapped as both a node and a way).
            if (listings.some((kept) => isDuplicateOf(listing, kept))) continue;
            listings.push(listing);
        }
        return { listings, status: "available" };
    } catch {
        return { listings: [], status: "unavailable" };
    } finally {
        clearTimeout(timeout);
    }
};

// @desc    Public Nearby Help: verified NGOs + approved vets near a location,
//          plus external animal welfare organisations from OpenStreetMap,
//          with distance and contact details, no login required.
//          The endpoint is public on purpose and is the same for logged-out
//          and logged-in users, so both receive the same two groups.
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
    // Batch 5 fix: $geoNear fails with a 500 when the collection does
    // not exist yet (a fresh database with no vets, for example), even
    // though the correct answer is simply "no vets nearby". A missing
    // collection is therefore treated as an empty result, not an error.
    const geoNear = async (Model, query) => {
        if ((await Model.countDocuments()) === 0) return [];
        return await Model.aggregate([
            { $geoNear: { near: { type: "Point", coordinates: [parsedLng, parsedLat] }, distanceField: "distanceMeters", maxDistance, spherical: true, query } },
            { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "contact" } },
        ]);
    };
    const ngoDocs = await geoNear(Ngo, { verificationStatus: "verified" });
    const vetDocs = await geoNear(Vet, { verificationStatus: "verified" });

    const ngos = ngoDocs.map(shapeNgo);
    const vets = vetDocs.map(shapeVet);
    // The verified group is the registered listings only, merged and
    // sorted by distance. The ngos/vets fields above are kept unchanged
    // (apart from the new source, status, coordinate and label fields) so
    // existing consumers of this endpoint keep working.
    const verified = sortByDistance([...ngos, ...vets]);

    // External listings are fetched after the registered ones and never
    // block them: if Overpass is slow or down, the registered listings
    // are still returned with osmStatus "unavailable" and an empty
    // nonVerified group. Registered listings always win a duplicate.
    const { listings: osmListings, status: osmStatus } = await fetchOsmListings(parsedLat, parsedLng, maxDistance);
    const nonVerified = sortByDistance(
        osmListings.filter((listing) => !verified.some((kept) => isDuplicateOf(listing, kept))),
    );

    const total = verified.length + nonVerified.length;
    const message =
        `Found ${verified.length} verified and ${nonVerified.length} external resources within ${radius} km.` +
        (osmStatus === "unavailable" ? " External (OpenStreetMap) results were unavailable, so only registered resources are shown." : "");
    return res.status(200).json(new ApiResponse(200, {
        ngos,
        vets,
        verified,
        nonVerified,
        total,
        verifiedTotal: verified.length,
        nonVerifiedTotal: nonVerified.length,
        radiusKm: radius,
        attribution: OSM_ATTRIBUTION,
        osmStatus,
    }, message));
});
