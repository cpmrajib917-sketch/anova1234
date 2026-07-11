// @ts-nocheck
import { 
  ref, 
  set, 
  push, 
  onValue, 
  update, 
  remove, 
  get, 
  serverTimestamp 
} from "firebase/database";
import { db } from "./firebase";
import { Comment, Reply, WatchProgress, Anime } from "../types";

// Helper to sanitize emails for Firebase RTDB paths
export function sanitizeEmail(email: string): string {
  if (!email) return 'guest';
  return email.toLowerCase().replace(/\./g, '_dot_').replace(/@/g, '_at_');
}

// Generate a random session ID
export const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// ==========================================
// 1. AUTHENTICATION & USER TRACKING
// ==========================================

export interface UserProfile {
  uid: string;
  email: string;
  username: string;
  role: 'admin' | 'user';
  status: 'Premium' | 'VIP';
  commentsCount: number;
  favoritesCount: number;
  lastLoginAt: number;
  createdAt: number;
}

export async function trackUserLogin(email: string) {
  const sanitized = sanitizeEmail(email);
  const userRef = ref(db, `users/${sanitized}`);
  
  const snapshot = await get(userRef);
  const now = Date.now();
  const username = email.split('@')[0];
  const role = email === 'mdido406@gmail.com' ? 'admin' : 'user';

  let userData: UserProfile;

  if (snapshot.exists()) {
    const existing = snapshot.val();
    userData = {
      ...existing,
      role, // Ensure role conforms to rules
      lastLoginAt: now
    };
    await update(userRef, { lastLoginAt: now, role });
  } else {
    userData = {
      uid: sanitized,
      email,
      username,
      role,
      status: role === 'admin' ? 'VIP' : 'Premium',
      commentsCount: 0,
      favoritesCount: 0,
      lastLoginAt: now,
      createdAt: now
    };
    await set(userRef, userData);
  }

  // Record login session in /sessions
  const sessionRef = ref(db, `sessions/${sessionId}`);
  await set(sessionRef, {
    id: sessionId,
    email,
    username,
    role,
    loginTime: now,
    lastHeartbeat: now
  });

  return userData;
}

// Keep-alive heartbeat for online tracking (active within last 2 minutes)
export async function trackUserHeartbeat(email: string, currentPath: string = '/home') {
  const sanitized = sanitizeEmail(email);
  const now = Date.now();
  
  // Update overall session heartbeat
  const sessionRef = ref(db, `sessions/${sessionId}`);
  await update(sessionRef, { lastHeartbeat: now });

  // Update specific online user entry
  const onlineRef = ref(db, `onlineUsers/${sessionId}`);
  await set(onlineRef, {
    id: sessionId,
    email,
    username: email ? email.split('@')[0] : 'Guest',
    lastActive: now,
    currentPath
  });
}

// Clean up user from online list upon logging out or closing
export async function trackUserLogout() {
  const onlineRef = ref(db, `onlineUsers/${sessionId}`);
  await remove(onlineRef);
  const sessionRef = ref(db, `sessions/${sessionId}`);
  await remove(sessionRef);
}

// ==========================================
// 2. WATCH EVENTS & HISTORY
// ==========================================

export async function logWatchEvent(
  animeId: string, 
  animeTitle: string, 
  animePoster: string, 
  episode: number, 
  email: string, 
  watchTime: number,
  duration: number
) {
  const viewRef = push(ref(db, 'views'));
  await set(viewRef, {
    id: viewRef.key,
    animeId,
    animeTitle,
    animePoster,
    episode,
    userEmail: email || 'guest@anova.xyz',
    timestamp: Date.now(),
    watchTime,
    duration
  });

  // Increment total view counts
  const statRef = ref(db, `statistics/animeViews/${animeId}`);
  const snap = await get(statRef);
  if (snap.exists()) {
    const data = snap.val();
    await update(statRef, {
      views: (data.views || 0) + 1,
      watchTime: (data.watchTime || 0) + watchTime,
      title: animeTitle,
      poster: animePoster
    });
  } else {
    await set(statRef, {
      animeId,
      title: animeTitle,
      poster: animePoster,
      views: 1,
      watchTime
    });
  }
}

export async function saveWatchProgressDb(email: string, progress: WatchProgress) {
  if (!email) return;
  const sanitized = sanitizeEmail(email);
  const progressRef = ref(db, `watchHistory/${sanitized}/${progress.animeId}`);
  await set(progressRef, progress);
}

export async function getWatchHistoryDb(email: string): Promise<Record<string, WatchProgress>> {
  if (!email) return {};
  const sanitized = sanitizeEmail(email);
  const historyRef = ref(db, `watchHistory/${sanitized}`);
  const snap = await get(historyRef);
  return snap.exists() ? snap.val() : {};
}

// ==========================================
// 3. FAVORITES & BOOKMARKS
// ==========================================

export async function saveFavoriteDb(email: string, anime: Anime, isFavorite: boolean) {
  if (!email) return;
  const sanitized = sanitizeEmail(email);
  const favoriteRef = ref(db, `favorites/${sanitized}/${anime.id}`);
  
  if (isFavorite) {
    await set(favoriteRef, anime);
  } else {
    await remove(favoriteRef);
  }

  // Update favoritesCount on user profile
  const userRef = ref(db, `users/${sanitized}`);
  const userSnap = await get(userRef);
  if (userSnap.exists()) {
    const currentFavsRef = ref(db, `favorites/${sanitized}`);
    const favsSnap = await get(currentFavsRef);
    const count = favsSnap.exists() ? Object.keys(favsSnap.val()).length : 0;
    await update(userRef, { favoritesCount: count });
  }
}

export async function getFavoritesDb(email: string): Promise<Anime[]> {
  if (!email) return [];
  const sanitized = sanitizeEmail(email);
  const favoritesRef = ref(db, `favorites/${sanitized}`);
  const snap = await get(favoritesRef);
  return snap.exists() ? Object.values(snap.val()) : [];
}

export async function saveBookmarkDb(email: string, anime: Anime, isBookmarked: boolean) {
  if (!email) return;
  const sanitized = sanitizeEmail(email);
  const bookmarkRef = ref(db, `bookmarks/${sanitized}/${anime.id}`);
  if (isBookmarked) {
    await set(bookmarkRef, anime);
  } else {
    await remove(bookmarkRef);
  }
}

export async function getBookmarksDb(email: string): Promise<Anime[]> {
  if (!email) return [];
  const sanitized = sanitizeEmail(email);
  const bookmarksRef = ref(db, `bookmarks/${sanitized}`);
  const snap = await get(bookmarksRef);
  return snap.exists() ? Object.values(snap.val()) : [];
}

// ==========================================
// 4. DISCUSSION / COMMENTS SYSTEM (REAL-TIME)
// ==========================================

export function syncComments(onUpdate: (comments: Comment[]) => void) {
  const commentsRef = ref(db, 'comments');
  
  return onValue(commentsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const list: Comment[] = Object.keys(data).map(key => {
        const item = data[key];
        // Ensure replies is always mapped to array, even if stored as object
        const repliesList: Reply[] = item.replies 
          ? Object.keys(item.replies).map(rKey => item.replies[rKey])
          : [];
        return {
          ...item,
          id: key,
          likedBy: item.likedBy ? Object.values(item.likedBy) : [],
          replies: repliesList.sort((a, b) => a.timestamp - b.timestamp)
        };
      });
      onUpdate(list);
    } else {
      onUpdate([]);
    }
  });
}

export async function addCommentDb(
  animeId: string, 
  episodeNumber: number | undefined, 
  username: string, 
  email: string, 
  avatar: string, 
  body: string
) {
  const commentsRef = ref(db, 'comments');
  const newCommentRef = push(commentsRef);
  const commentId = newCommentRef.key;

  const newComment = {
    id: commentId,
    animeId,
    episodeNumber: episodeNumber || null,
    username,
    email,
    avatar,
    body,
    timestamp: Date.now(),
    likes: 0,
    pinned: false,
    reported: false
  };

  await set(newCommentRef, newComment);

  // Increment user comments count
  const sanitized = sanitizeEmail(email);
  const userRef = ref(db, `users/${sanitized}`);
  const snap = await get(userRef);
  if (snap.exists()) {
    const existing = snap.val();
    await update(userRef, { commentsCount: (existing.commentsCount || 0) + 1 });
  }
}

export async function deleteCommentDb(commentId: string) {
  const commentRef = ref(db, `comments/${commentId}`);
  await remove(commentRef);
}

export async function likeCommentDb(commentId: string, userEmail: string) {
  const commentRef = ref(db, `comments/${commentId}`);
  const snap = await get(commentRef);
  if (!snap.exists()) return;

  const data = snap.val();
  const likedByObj = data.likedBy || {};
  const sanitizedEmail = sanitizeEmail(userEmail);
  
  const alreadyLiked = likedByObj[sanitizedEmail] !== undefined;

  if (alreadyLiked) {
    await remove(ref(db, `comments/${commentId}/likedBy/${sanitizedEmail}`));
    await update(commentRef, { likes: Math.max(0, (data.likes || 1) - 1) });
  } else {
    await set(ref(db, `comments/${commentId}/likedBy/${sanitizedEmail}`), userEmail);
    await update(commentRef, { likes: (data.likes || 0) + 1 });
  }
}

export async function pinCommentDb(commentId: string, pinned: boolean) {
  const commentRef = ref(db, `comments/${commentId}`);
  await update(commentRef, { pinned });
}

export async function reportCommentDb(commentId: string) {
  const commentRef = ref(db, `comments/${commentId}`);
  await update(commentRef, { reported: true });

  // Save report to reports queue
  const reportRef = push(ref(db, 'reports'));
  await set(reportRef, {
    id: reportRef.key,
    commentId,
    timestamp: Date.now(),
    status: 'pending'
  });
}

export async function addReplyDb(
  commentId: string, 
  username: string, 
  email: string, 
  avatar: string, 
  body: string
) {
  const repliesRef = ref(db, `comments/${commentId}/replies`);
  const newReplyRef = push(repliesRef);
  const replyId = newReplyRef.key;

  const newReply = {
    id: replyId,
    commentId,
    username,
    email,
    avatar,
    body,
    timestamp: Date.now(),
    likes: 0
  };

  await set(newReplyRef, newReply);
}

export async function likeReplyDb(commentId: string, replyId: string, userEmail: string) {
  const replyRef = ref(db, `comments/${commentId}/replies/${replyId}`);
  const snap = await get(replyRef);
  if (!snap.exists()) return;

  const data = snap.val();
  const likedByObj = data.likedBy || {};
  const sanitizedEmail = sanitizeEmail(userEmail);
  
  const alreadyLiked = likedByObj[sanitizedEmail] !== undefined;

  if (alreadyLiked) {
    await remove(ref(db, `comments/${commentId}/replies/${replyId}/likedBy/${sanitizedEmail}`));
    await update(replyRef, { likes: Math.max(0, (data.likes || 1) - 1) });
  } else {
    await set(ref(db, `comments/${commentId}/replies/${replyId}/likedBy/${sanitizedEmail}`), userEmail);
    await update(replyRef, { likes: (data.likes || 0) + 1 });
  }
}

export async function deleteReplyDb(commentId: string, replyId: string) {
  const replyRef = ref(db, `comments/${commentId}/replies/${replyId}`);
  await remove(replyRef);
}

// ==========================================
// CUSTOM ANIME & EPISODE SYSTEM
// ==========================================

export async function addCustomAnime(id: string, anime: any) {
  const animeRef = ref(db, `animes/${id}`);
  await set(animeRef, anime);
}

export async function deleteCustomAnime(id: string) {
  const animeRef = ref(db, `animes/${id}`);
  await remove(animeRef);
  
  // Also delete corresponding episodes
  const episodesRef = ref(db, `episodes/${id}`);
  await remove(episodesRef);
}

export async function getCustomAnimes(): Promise<Record<string, any>> {
  const animesRef = ref(db, 'animes');
  const snap = await get(animesRef);
  if (snap.exists()) {
    return snap.val();
  }
  return {};
}

export async function addCustomEpisode(animeId: string, episodeNumber: number, episode: any) {
  const epRef = ref(db, `episodes/${animeId}/${episodeNumber}`);
  await set(epRef, episode);
}

export async function getCustomEpisodes(animeId: string): Promise<Record<string, any>> {
  const episodesRef = ref(db, `episodes/${animeId}`);
  const snap = await get(episodesRef);
  if (snap.exists()) {
    return snap.val();
  }
  return {};
}

// ==========================================
// ADVERTISEMENT MANAGEMENT SYSTEM
// ==========================================

export async function addAdvertisement(id: string, ad: any) {
  const adRef = ref(db, `advertisements/${id}`);
  await set(adRef, ad);
}

export async function deleteAdvertisement(id: string) {
  const adRef = ref(db, `advertisements/${id}`);
  await remove(adRef);
}

export async function getAdvertisements(): Promise<Record<string, any>> {
  const adsRef = ref(db, 'advertisements');
  const snap = await get(adsRef);
  if (snap.exists()) {
    return snap.val();
  }
  return {};
}

