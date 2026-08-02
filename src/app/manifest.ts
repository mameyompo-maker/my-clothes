import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Clothes",
    short_name: "My Clothes",
    description: "朝のコーデ選びを、友達と一緒に。",
    start_url: "/feed",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#ff5a5f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
