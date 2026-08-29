import multer from "multer"

const storage = multer.diskStorage({
    destination: function (req, file ,cb){
        cb(null, "./public/temp")
    },
filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
}
});

const fileFilter  = (req,file,cb) => {

    const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "application/pdf",
    ];

if( allowedMimeTypes.includes(file.mimetype)){
    cb(null,true);
}
else{

    cb(new Error("Invalid file type. Only JPG, PNG, and PDF files are allowed!"), false);
}

};

export const upload = multer({
    storage , 
    fileFilter,
});