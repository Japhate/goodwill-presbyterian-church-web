import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore, updateDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OPTIMIZED_DIR = path.join(ROOT_DIR, "public", "images", "hero", "optimized");
const LOCAL_ENV_FILE = path.join(ROOT_DIR, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  }
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function normalizeHeroName(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.hostname === "firebasestorage.googleapis.com") {
      const objectPath = decodeURIComponent(url.pathname.split("/o/")[1]?.split("?")[0] || "");
      return path.basename(objectPath).replace(/\.(png|jpe?g|webp)$/i, "");
    }
  } catch {
    // Local paths land here.
  }

  return path.basename(value).replace(/\.(png|jpe?g|webp)$/i, "");
}

loadEnvFile(LOCAL_ENV_FILE);

const firebaseConfig = {
  apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
  authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: requiredEnv("VITE_FIREBASE_APP_ID"),
};

const adminEmail = requiredEnv("FIREBASE_ADMIN_EMAIL");
const adminPassword = requiredEnv("FIREBASE_ADMIN_PASSWORD");

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

const optimizedFiles = fs
  .readdirSync(OPTIMIZED_DIR)
  .filter((file) => file.toLowerCase().endsWith(".jpg"))
  .sort();

if (optimizedFiles.length === 0) {
  throw new Error(`No optimized JPG files found in ${OPTIMIZED_DIR}`);
}

const downloadUrlsByName = new Map();

for (const file of optimizedFiles) {
  const filePath = path.join(OPTIMIZED_DIR, file);
  const bytes = fs.readFileSync(filePath);
  const storagePath = `homepage-hero-images/optimized/${file}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, bytes, {
    contentType: "image/jpeg",
    cacheControl: "public,max-age=31536000",
  });

  const url = await getDownloadURL(storageRef);
  downloadUrlsByName.set(normalizeHeroName(file), url);
  console.log(`Uploaded ${file}`);
}

const snapshot = await getDocs(collection(db, "HeroSlide"));
let updatedCount = 0;
let skippedCount = 0;

for (const document of snapshot.docs) {
  const slide = document.data();
  const heroName = normalizeHeroName(slide.image_url);
  const firebaseUrl = downloadUrlsByName.get(heroName);

  if (!firebaseUrl) {
    skippedCount += 1;
    continue;
  }

  if (slide.image_url === firebaseUrl) {
    skippedCount += 1;
    continue;
  }

  await updateDoc(document.ref, {
    image_url: firebaseUrl,
    updated_date: new Date().toISOString(),
  });
  updatedCount += 1;
  console.log(`Updated HeroSlide/${document.id} -> ${heroName}.jpg`);
}

console.log(`Done. Uploaded ${optimizedFiles.length} files. Updated ${updatedCount} slides. Skipped ${skippedCount} slides.`);
