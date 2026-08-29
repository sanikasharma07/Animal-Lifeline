import {v2 as cloudinary} from "cloudinary";
import fs from "fs";
import dotenv from "dotenv"

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

export const uploadOnCloudinary = async (localFilePath) => {
   try{
    if(!localFilePath) return null;

    const response = await cloudinary.uploader.upload(localFilePath , {
      resource_type: "auto"
    });

    // File uploaded successfully, now delete the local copy
    fs.unlinkSync(localFilePath)

    return response
   }
   catch(error){
   // If upload fails, we MUST delete the local file to prevent junk files piling up
        if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        
       throw new Error(`Cloudinary Error: ${error.message}`);
   }
}

