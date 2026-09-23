import { route } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { MEDIA_TYPES, storeUpload } from "@/lib/uploads";

/** Pre-upload media on Compose before generating (attached to the brief on Generate). */
export const POST = route(async (req) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file");
  return storeUpload(file, file.type.startsWith("video/") ? "video" : "image", { allow: MEDIA_TYPES, prefix: "uploads/compose" });
});
