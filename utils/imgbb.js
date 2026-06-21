// Uploads a base64 image string to ImgBB and returns the hosted URL.
// Client sends the file as a base64 string (without the data: prefix).
async function uploadToImgBB(base64Image) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    throw new Error("IMGBB_API_KEY is not configured");
  }

  // Strip a possible "data:image/...;base64," prefix.
  const cleaned = base64Image.includes(",")
    ? base64Image.split(",")[1]
    : base64Image;

  const form = new URLSearchParams();
  form.append("image", cleaned);

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${apiKey}`,
    {
      method: "POST",
      body: form,
    }
  );

  const data = await response.json();

  if (!data.success) {
    throw new Error(data?.error?.message || "ImgBB upload failed");
  }

  return data.data.url;
}

module.exports = { uploadToImgBB };
