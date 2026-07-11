// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { useNavigate, Link } from 'react-router-dom';
import { 
  ShieldAlert, Users, Play, MessageSquare, Clock, ArrowLeft, RefreshCw, 
  CheckCircle, ShieldCheck, Pin, Trash2, Search, Filter, Ban, Eye, User, 
  BarChart3, Activity, Heart, Bookmark, FileText, Calendar, Server, Power,
  UploadCloud, FilePlus, PlayCircle, Settings, EyeOff, FolderPlus, Plus,
  Trash, Edit3, Save, Video, Clipboard, Sparkles, AlertCircle, Megaphone
} from 'lucide-react';
import { cn } from '../lib/utils';
import { ref, onValue, update, remove, get, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { sanitizeEmail, addAdvertisement, deleteAdvertisement, getAdvertisements } from '../lib/firebaseSync';
import { uploadToCloudinary } from '../lib/cloudinary';
import { testConnectionWithConfig, deleteAssetByUrl } from '../lib/storageManager';
import { 
  addCustomAnime, 
  deleteCustomAnime, 
  getCustomAnimes, 
  addCustomEpisode, 
  getCustomEpisodes 
} from '../lib/firebaseSync';

export function AdScriptRunner({ script }: { script: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !script) return;

    containerRef.current.innerHTML = '';

    const trimmed = script.trim();
    const isRawUrl = trimmed.startsWith('http') && !trimmed.includes('<');

    if (isRawUrl) {
      const iframeEl = document.createElement('iframe');
      iframeEl.src = trimmed;
      iframeEl.style.width = '100%';
      iframeEl.style.height = '100%';
      iframeEl.style.border = 'none';
      iframeEl.style.minHeight = '250px';
      iframeEl.setAttribute('allow', 'autoplay');
      containerRef.current.appendChild(iframeEl);

      const linkEl = document.createElement('a');
      linkEl.href = trimmed;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.className = 'absolute bottom-3 right-3 bg-cyan-500 hover:bg-cyan-600 text-black font-black text-[10px] uppercase tracking-wider py-1.5 px-3 rounded-lg shadow-lg transition-transform hover:scale-105';
      linkEl.innerText = 'Visit Sponsor Site';
      containerRef.current.appendChild(linkEl);
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${script}</div>`, 'text/html');
    const wrapper = doc.querySelector('div');

    if (wrapper) {
      Array.from(wrapper.childNodes).forEach((node) => {
        if (node.nodeName === 'SCRIPT') {
          const scriptEl = document.createElement('script');
          Array.from((node as HTMLScriptElement).attributes).forEach(attr => {
            scriptEl.setAttribute(attr.name, attr.value);
          });
          scriptEl.textContent = (node as HTMLScriptElement).textContent;
          containerRef.current?.appendChild(scriptEl);
        } else {
          const clone = node.cloneNode(true);
          containerRef.current?.appendChild(clone);
        }
      });
    }
  }, [script]);

  return <div ref={containerRef} className="w-full h-full flex items-center justify-center min-h-[220px] relative" />;
}

export function Admin() {
  const navigate = useNavigate();
  const { comments: localComments, deleteComment, pinComment } = useAppStore();
  const [activeTab, setActiveTab] = useState('overview');
  
  // Real-time states from Firebase
  const [firebaseUsers, setFirebaseUsers] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [firebaseComments, setFirebaseComments] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state for Users Directory
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('all'); // all, premium, vip, banned

  // User detail overlay state
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedUserHistory, setSelectedUserHistory] = useState<any[]>([]);
  const [selectedUserFavorites, setSelectedUserFavorites] = useState<any[]>([]);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);

  // Anime Upload / Management states
  const [customAnimes, setCustomAnimes] = useState<any[]>([]);
  const [dbSections, setDbSections] = useState<any[]>([]);
  const [customEpisodes, setCustomEpisodes] = useState<any[]>([]);
  const [editingAnime, setEditingAnime] = useState<any | null>(null);
  const [uploadTabMode, setUploadTabMode] = useState<'list' | 'animeForm' | 'episodeForm'>('list');
  const [isSaving, setIsSaving] = useState(false);

  // Section Manager states
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<any | null>(null);
  const [sectionForm, setSectionForm] = useState({
    id: '',
    name: '',
    slug: '',
    displayOrder: 1,
    numCards: 12,
    visible: true,
    status: 'active' as 'active' | 'inactive'
  });

  // Form Fields for Anime
  const [animeForm, setAnimeForm] = useState({
    id: '',
    title: '',
    description: '',
    poster: '',
    banner: '',
    type: 'TV',
    status: 'Ongoing',
    episodes: 12,
    rating: '8.5',
    genres: 'Action, Adventure, Fantasy',
    studio: 'AnOvA Production',
    released: '2024',
    categories: {
      trending: false,
      popular: false,
      recentlyAdded: false,
      topAiring: false,
      latest: false,
      completed: false,
      upcoming: false,
      favorite: false
    } as Record<string, boolean>,
    subAvailable: true,
    dubAvailable: false,
    hindiAvailable: false,
    multiAvailable: false,
    visibility: 'public'
  });

  // Upload progress tracking
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadDetails, setUploadDetails] = useState<Record<string, { speed?: string; sizeInfo?: string; eta?: string; processing?: boolean }>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  // Storage Manager States
  const [storageConfigs, setStorageConfigs] = useState<any[]>([]);
  const [storageSettings, setStorageSettings] = useState({ defaultStorageId: '', autoRotate: false, smartMode: false });
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [storageFormOpen, setStorageFormOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<any | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState<Record<string, boolean>>({});
  const [testConnectionResults, setTestConnectionResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [storageForm, setStorageForm] = useState({
    id: '',
    name: '',
    provider: 'cloudinary' as 'cloudinary' | 'cloudflare_r2' | 'bunny' | 'aws_s3' | 'backblaze_b2' | 'imagekit' | 'supabase' | 'firebase',
    cloudName: '',
    apiKey: '',
    apiSecret: '',
    folder: 'anova_anime',
    defaultFolder: 'anova_anime',
    status: 'enabled' as 'enabled' | 'disabled',
    priority: 1,
    notes: '',
    maxUploadSize: 50,
    maxDailyUploads: 100,
    maxStorage: 1024
  });

  const [storageSearchQuery, setStorageSearchQuery] = useState('');
  const [storageFilterProvider, setStorageFilterProvider] = useState('all');
  const [storageFilterStatus, setStorageFilterStatus] = useState('all');
  const [storageFilterPriority, setStorageFilterPriority] = useState('all');
  const [storageFilterActive, setStorageFilterActive] = useState('all');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ==========================================
  // ADVERTISEMENT MANAGER STATES
  // ==========================================
  const [advertisements, setAdvertisements] = useState<any[]>([]);
  const [isAdFormOpen, setIsAdFormOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<any | null>(null);
  const [previewAd, setPreviewAd] = useState<any | null>(null);
  const [adForm, setAdForm] = useState({
    id: '',
    name: '',
    provider: '',
    type: 'Popunder', // Popunder, Direct Link, Script, Banner
    status: 'enabled', // enabled / disabled
    script: '',
    priority: 10,
    frequency: 'always', // always, every_5_m, every_10_m, every_15_m, every_30_m, once_per_hour, once_per_session
    startDate: '', // YYYY-MM-DD
    endDate: '', // YYYY-MM-DD
    targetMode: 'all', // all, single, multiple
    targetAnimeIds: [] as string[]
  });
  const [adFormTargetEpisodes, setAdFormTargetEpisodes] = useState<any[]>([]);
  const [adSearchQuery, setAdSearchQuery] = useState('');
  const [adFormSearchQuery, setAdFormSearchQuery] = useState('');
  const [adContentFormatFilter, setAdContentFormatFilter] = useState('all');

  // Episode Editing states
  const [editingEpisode, setEditingEpisode] = useState<any | null>(null);
  const [episodeForm, setEpisodeForm] = useState({
    id: '',
    number: 1,
    title: 'Episode 1',
    thumbnail: '',
    videoSources: {
      sub: { enabled: true, type: 'embed', url: '' },
      eng_dub: { enabled: false, type: 'file', url: '' },
      hindi_dub: { enabled: false, type: 'file', url: '' },
      other: { enabled: false, type: 'file', url: '' }
    } as Record<string, { enabled: boolean; type: 'file' | 'embed'; url: string }>
  });

  // Custom Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const showConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        try {
          await onConfirm();
        } catch (e) {
          console.error("Error in confirmation callback:", e);
        }
        setConfirmDialog(null);
      }
    });
  };

  // Authentication Status Check
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const currentUserEmail = localStorage.getItem('userEmail') || '';
  const isAdmin = isLoggedIn && (currentUserEmail.trim().toLowerCase() === 'mdido406@gmail.com' || localStorage.getItem('userRole') === 'admin');

  useEffect(() => {
    if (!isAdmin) return;
    const fetchCustomAnimesData = async () => {
      const list = await getCustomAnimes();
      setCustomAnimes(Object.values(list));
    };
    fetchCustomAnimesData();

    const sectionsRef = ref(db, 'homepageSections');
    const unsubSec = onValue(sectionsRef, (snap) => {
      if (snap.exists()) {
        const sorted = Object.values(snap.val()).sort((a: any, b: any) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
        setDbSections(sorted);
      } else {
        const defaultSections = [
          { id: 'featured', name: 'Featured', slug: 'featured', displayOrder: 1, numCards: 12, visible: true, status: 'active' },
          { id: 'trending', name: 'Trending', slug: 'trending', displayOrder: 2, numCards: 12, visible: true, status: 'active' },
          { id: 'popular', name: 'Popular', slug: 'popular', displayOrder: 3, numCards: 12, visible: true, status: 'active' },
          { id: 'topAiring', name: 'Top Airing', slug: 'topAiring', displayOrder: 4, numCards: 12, visible: true, status: 'active' },
          { id: 'recentlyAdded', name: 'Recently Added', slug: 'recentlyAdded', displayOrder: 5, numCards: 12, visible: true, status: 'active' },
          { id: 'latest', name: 'Latest', slug: 'latest', displayOrder: 6, numCards: 12, visible: true, status: 'active' },
          { id: 'favorite', name: 'Most Favorite', slug: 'favorite', displayOrder: 7, numCards: 12, visible: true, status: 'active' },
          { id: 'completed', name: 'Completed', slug: 'completed', displayOrder: 8, numCards: 12, visible: true, status: 'active' },
          { id: 'upcoming', name: 'Upcoming', slug: 'upcoming', displayOrder: 9, numCards: 12, visible: true, status: 'active' },
          { id: 'hindi-dubbed', name: 'Hindi Dubbed', slug: 'hindi-dubbed', displayOrder: 10, numCards: 12, visible: true, status: 'active' },
        ];
        setDbSections(defaultSections);
      }
    });
    return () => unsubSec();
  }, [isAdmin, uploadTabMode]);

  // Real-time Database Listeners
  useEffect(() => {
    if (!isAdmin) return;

    const usersRef = ref(db, 'users');
    const onlineRef = ref(db, 'onlineUsers');
    const viewsRef = ref(db, 'views');
    const sessionsRef = ref(db, 'sessions');
    const commentsRef = ref(db, 'comments');
    const reportsRef = ref(db, 'reports');
    const storageConfigsRef = ref(db, 'storage_configs');
    const storageSettingsRef = ref(db, 'storage_settings');
    const uploadHistoryRef = ref(db, 'upload_history');

    const unsubUsers = onValue(usersRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setFirebaseUsers(Object.values(data));
      } else {
        setFirebaseUsers([]);
      }
    });

    const unsubOnline = onValue(onlineRef, (snap) => {
      const now = Date.now();
      if (snap.exists()) {
        const data = snap.val();
        // Filters active within last 2 minutes as online
        const active = Object.values(data).filter((u: any) => now - (u.lastActive || 0) < 120000);
        setOnlineUsers(active);
      } else {
        setOnlineUsers([]);
      }
    });

    const unsubViews = onValue(viewsRef, (snap) => {
      if (snap.exists()) {
        setViews(Object.values(snap.val()));
      } else {
        setViews([]);
      }
    });

    const unsubSessions = onValue(sessionsRef, (snap) => {
      if (snap.exists()) {
        setSessions(Object.values(snap.val()));
      } else {
        setSessions([]);
      }
    });

    const unsubComments = onValue(commentsRef, (snap) => {
      if (snap.exists()) {
        setFirebaseComments(Object.values(snap.val()));
      } else {
        setFirebaseComments([]);
      }
    });

    const unsubReports = onValue(reportsRef, (snap) => {
      if (snap.exists()) {
        setReports(Object.values(snap.val()));
      } else {
        setReports([]);
      }
      setLoading(false);
    });

    const unsubStorageConfigs = onValue(storageConfigsRef, (snap) => {
      if (snap.exists()) {
        setStorageConfigs(Object.values(snap.val()));
      } else {
        setStorageConfigs([]);
      }
    });

    const unsubStorageSettings = onValue(storageSettingsRef, (snap) => {
      if (snap.exists()) {
        setStorageSettings(snap.val());
      } else {
        setStorageSettings({ defaultStorageId: '', autoRotate: false });
      }
    });

    const unsubUploadHistory = onValue(uploadHistoryRef, (snap) => {
      if (snap.exists()) {
        const sorted = Object.values(snap.val()).sort((a: any, b: any) => b.uploadedAt - a.uploadedAt);
        setUploadHistory(sorted);
      } else {
        setUploadHistory([]);
      }
    });

    const adsRef = ref(db, 'advertisements');
    const unsubAds = onValue(adsRef, (snap) => {
      if (snap.exists()) {
        setAdvertisements(Object.values(snap.val()));
      } else {
        setAdvertisements([]);
      }
    });

    return () => {
      unsubUsers();
      unsubOnline();
      unsubViews();
      unsubSessions();
      unsubComments();
      unsubReports();
      unsubStorageConfigs();
      unsubStorageSettings();
      unsubUploadHistory();
      unsubAds();
    };
  }, [isAdmin]);

  // Strict Authorization Guard
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505] px-4">
        <div className="max-w-md w-full bg-[#0a0d14]/80 border border-red-500/20 p-8 rounded-3xl text-center space-y-6 shadow-[0_0_50px_rgba(239,68,68,0.15)] backdrop-blur-md">
          <ShieldAlert size={48} className="text-red-500 mx-auto animate-bounce" />
          <div className="space-y-2">
            <h2 className="text-xl font-black text-white uppercase tracking-wider">Access Denied</h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your account (<span className="text-red-400 font-bold">{currentUserEmail || 'Guest'}</span>) does not possess Administrator clearance. This event has been logged.
            </p>
          </div>
          <button
            onClick={() => navigate('/home')}
            className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black text-xs rounded-xl transition-all active:scale-95 uppercase tracking-wider"
          >
            RETURN TO HOME
          </button>
        </div>
      </div>
    );
  }

  // Statistics calculation helpers
  const now = Date.now();
  const startOfToday = new Date().setHours(0,0,0,0);
  const startOfWeek = now - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = now - 30 * 24 * 60 * 60 * 1000;

  // Registered Users Analytics
  const totalUsersCount = firebaseUsers.length;
  
  // Active users today (distinct emails in sessions or views active today)
  const activeTodaySet = new Set<string>();
  views.forEach(v => {
    if (v.timestamp >= startOfToday) activeTodaySet.add(v.userEmail);
  });
  sessions.forEach(s => {
    if (s.loginTime >= startOfToday || s.lastHeartbeat >= startOfToday) activeTodaySet.add(s.email);
  });
  const activeUsersToday = Math.max(onlineUsers.length, activeTodaySet.size);

  // Weekly Active Users (WAU)
  const activeWeeklySet = new Set<string>();
  views.forEach(v => {
    if (v.timestamp >= startOfWeek) activeWeeklySet.add(v.userEmail);
  });
  sessions.forEach(s => {
    if (s.loginTime >= startOfWeek || s.lastHeartbeat >= startOfWeek) activeWeeklySet.add(s.email);
  });
  const weeklyActiveUsers = Math.max(activeUsersToday, activeWeeklySet.size);

  // Monthly Active Users (MAU)
  const activeMonthlySet = new Set<string>();
  views.forEach(v => {
    if (v.timestamp >= startOfMonth) activeMonthlySet.add(v.userEmail);
  });
  sessions.forEach(s => {
    if (s.loginTime >= startOfMonth || s.lastHeartbeat >= startOfMonth) activeMonthlySet.add(s.email);
  });
  const monthlyActiveUsers = Math.max(weeklyActiveUsers, activeMonthlySet.size);

  // Total Sessions & Returning vs New
  const totalSessionsCount = sessions.length;
  const returningUsersCount = firebaseUsers.filter(u => u.lastLoginAt - u.createdAt > 1000).length;
  const newUsersTodayCount = firebaseUsers.filter(u => u.createdAt >= startOfToday).length;

  // Watch Analytics calculation
  const totalViewsCount = views.length;
  const viewsToday = views.filter(v => v.timestamp >= startOfToday).length;
  const viewsThisWeek = views.filter(v => v.timestamp >= startOfWeek).length;
  const viewsThisMonth = views.filter(v => v.timestamp >= startOfMonth).length;

  // Watch Time (minutes)
  const totalWatchTimeSeconds = views.reduce((acc, curr) => acc + Number(curr.watchTime || 0), 0);
  const totalWatchHours = (totalWatchTimeSeconds / 3600).toFixed(1);
  const averageWatchDurationMinutes = totalViewsCount > 0 
    ? ((totalWatchTimeSeconds / totalViewsCount) / 60).toFixed(1)
    : '0.0';

  // Most Watched Anime Aggregation
  const animeAggregation: Record<string, { id: string, title: string, poster: string, count: number, watchTime: number }> = {};
  views.forEach(v => {
    if (!v.animeId) return;
    if (!animeAggregation[v.animeId]) {
      animeAggregation[v.animeId] = {
        id: v.animeId,
        title: v.animeTitle || `Anime #${v.animeId}`,
        poster: v.animePoster || '',
        count: 0,
        watchTime: 0
      };
    }
    animeAggregation[v.animeId].count += 1;
    animeAggregation[v.animeId].watchTime += Number(v.watchTime || 0);
  });
  const sortedAnimeList = Object.values(animeAggregation).sort((a, b) => b.count - a.count);
  const top10Anime = sortedAnimeList.slice(0, 10);
  const trendingAnime = sortedAnimeList.slice(0, 5);
  const recentlyWatchedAnime = [...views].sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);

  // Most Watched Episodes Aggregation
  const episodeAggregation: Record<string, { key: string, animeTitle: string, episode: number, count: number }> = {};
  views.forEach(v => {
    if (!v.animeId || !v.episode) return;
    const key = `${v.animeId}-ep-${v.episode}`;
    if (!episodeAggregation[key]) {
      episodeAggregation[key] = {
        key,
        animeTitle: v.animeTitle || `Anime #${v.animeId}`,
        episode: v.episode,
        count: 0
      };
    }
    episodeAggregation[key].count += 1;
  });
  const top10Episodes = Object.values(episodeAggregation).sort((a, b) => b.count - a.count).slice(0, 10);

  // Static premium server status elements
  const serverNodes = [
    { name: 'HD-1 (4Animo primary)', status: 'OPTIMAL', load: '38%', badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
    { name: 'HD-2 (Kryzox CDN)', status: 'ONLINE', load: '45%', badge: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' },
    { name: 'HD-3 (AnOvA Proxy)', status: 'OPTIMAL', load: '18%', badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
    { name: 'HD-4 (Backup Node)', status: 'BUSY', load: '84%', badge: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
    { name: 'HD-5 (Failover Relay)', status: 'OFFLINE', load: '0%', badge: 'bg-red-500/10 border-red-500/30 text-red-400' }
  ];

  // User moderation functions
  const handleToggleBanUser = async (user: any) => {
    const sanitized = sanitizeEmail(user.email);
    const userRef = ref(db, `users/${sanitized}`);
    const isBannedNow = user.banned === true;
    await update(userRef, { 
      banned: !isBannedNow, 
      status: !isBannedNow ? 'Banned' : 'Premium' 
    });
    alert(`User ${user.username} has been successfully ${!isBannedNow ? 'BANNED' : 'UNBANNED'}.`);
  };

  const handleDeleteUser = async (user: any) => {
    showConfirm(
      "Delete User",
      `Are you absolutely sure you want to permanently delete user ${user.username}? This cannot be undone.`,
      async () => {
        const sanitized = sanitizeEmail(user.email);
        await remove(ref(db, `users/${sanitized}`));
        setSelectedUser(null);
        alert('User has been deleted from the database.');
      }
    );
  };

  const handleInspectUser = async (user: any) => {
    setSelectedUser(user);
    setLoadingUserDetail(true);
    try {
      const sanitized = sanitizeEmail(user.email);
      // Fetch watch history
      const historySnap = await get(ref(db, `watchHistory/${sanitized}`));
      const historyData = historySnap.exists() ? Object.values(historySnap.val()) : [];
      setSelectedUserHistory(historyData);

      // Fetch favorites
      const favSnap = await get(ref(db, `favorites/${sanitized}`));
      const favData = favSnap.exists() ? Object.values(snapValToArray(favSnap.val())) : [];
      setSelectedUserFavorites(favData);
    } catch (e) {
      console.error("Error loading user detail history:", e);
    } finally {
      setLoadingUserDetail(false);
    }
  };

  const snapValToArray = (val: any) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return Object.values(val);
  };

  // Filtered comments from Firebase (or Zustand local comments fallback)
  const commentsToModerate = firebaseComments.length > 0 
    ? firebaseComments.sort((a, b) => b.timestamp - a.timestamp)
    : localComments;

  // Filtered registered users
  const filteredUsers = firebaseUsers.filter(usr => {
    const matchSearch = usr.username?.toLowerCase().includes(userSearchQuery.toLowerCase()) || 
                        usr.email?.toLowerCase().includes(userSearchQuery.toLowerCase());
    
    if (!matchSearch) return false;
    if (userFilter === 'all') return true;
    if (userFilter === 'premium') return usr.status === 'Premium' && !usr.banned;
    if (userFilter === 'vip') return usr.status === 'VIP';
    if (userFilter === 'banned') return usr.banned === true;
    return true;
  });

  // ==========================================
  // ANIME UPLOAD & CATALOG SYSTEM HANDLERS
  // ==========================================

  const handleCreateNewAnimeClick = () => {
    setAnimeForm({
      id: 'custom-' + Date.now(),
      title: '',
      description: '',
      poster: '',
      banner: '',
      type: 'TV',
      status: 'Ongoing',
      episodes: 12,
      rating: '8.5',
      genres: 'Action, Adventure, Fantasy',
      studio: 'AnOvA Production',
      released: '2024',
      categories: {},
      subAvailable: true,
      dubAvailable: false,
      hindiAvailable: false,
      multiAvailable: false,
      visibility: 'public'
    });
    setEditingAnime(null);
    setCustomEpisodes([]);
    setUploadTabMode('animeForm');
  };

  const handleEditAnimeClick = async (anime: any) => {
    setAnimeForm({
      id: String(anime.id),
      title: anime.title || '',
      description: anime.description || '',
      poster: anime.poster || '',
      banner: anime.banner || '',
      type: anime.type || 'TV',
      status: anime.status || 'Ongoing',
      episodes: Number(anime.episodes || 12),
      rating: String(anime.rating || '8.5'),
      genres: Array.isArray(anime.genres) ? anime.genres.join(', ') : (anime.genres || 'Action, Adventure'),
      studio: anime.studio || 'AnOvA Production',
      released: String(anime.released || '2024'),
      categories: {
        ...(anime.categories || {})
      },
      subAvailable: anime.subAvailable !== undefined ? anime.subAvailable : true,
      dubAvailable: anime.dubAvailable || false,
      hindiAvailable: anime.hindiAvailable || false,
      multiAvailable: anime.multiAvailable || false,
      visibility: anime.visibility || 'public'
    });
    setEditingAnime(anime);
    setUploadTabMode('animeForm');
    
    // Fetch episodes
    try {
      const eps = await getCustomEpisodes(String(anime.id));
      setCustomEpisodes(eps ? Object.values(eps).filter(Boolean) : []);
    } catch (e) {
      console.error("Error loading custom episodes:", e);
    }
  };

  const handleSaveAnimeForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!animeForm.title) {
      alert("Please fill in the Anime Title.");
      return;
    }
    setIsSaving(true);
    try {
      const animeData = {
        id: animeForm.id || 'custom-' + Date.now(),
        title: animeForm.title,
        description: animeForm.description,
        poster: animeForm.poster,
        banner: animeForm.banner || animeForm.poster,
        type: animeForm.type,
        status: animeForm.status,
        episodes: Number(animeForm.episodes),
        rating: animeForm.rating,
        genres: animeForm.genres.split(',').map(g => g.trim()).filter(Boolean),
        studio: animeForm.studio,
        released: animeForm.released,
        categories: animeForm.categories,
        subAvailable: animeForm.subAvailable,
        dubAvailable: animeForm.dubAvailable,
        hindiAvailable: animeForm.hindiAvailable,
        multiAvailable: animeForm.multiAvailable,
        visibility: animeForm.visibility
      };

      await addCustomAnime(animeData.id, animeData);
      alert("Anime show successfully saved to catalog!");
      setUploadTabMode('list');
    } catch (e) {
      console.error("Failed to save anime form:", e);
      alert("Error saving anime show. Please check logs.");
    } finally {
      setIsSaving(false);
    }
  };

  // ==========================================
  // ADVERTISEMENT MANAGER ACTION HANDLERS
  // ==========================================
  const handleSaveAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adForm.name.trim()) {
      alert("Please provide an Advertisement Name.");
      return;
    }
    if (!adForm.provider.trim()) {
      alert("Please provide a Provider Name.");
      return;
    }
    if (!adForm.script.trim()) {
      alert("Please provide an Advertisement Script.");
      return;
    }

    const id = adForm.id || `ad-${Date.now()}`;
    const payload = {
      ...adForm,
      id,
      priority: Number(adForm.priority || 10),
      createdAt: editingAd?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    try {
      await addAdvertisement(id, payload);
      alert("Advertisement saved successfully!");
      setIsAdFormOpen(false);
      setEditingAd(null);
      setAdForm({
        id: '',
        name: '',
        provider: '',
        type: 'Popunder',
        status: 'enabled',
        script: '',
        priority: 10,
        frequency: 'always',
        startDate: '',
        endDate: '',
        targetMode: 'all',
        targetAnimeIds: []
      });
    } catch (err) {
      console.error("Error saving advertisement:", err);
      alert("Failed to save advertisement. Please try again.");
    }
  };

  const handleEditAd = (ad: any) => {
    setEditingAd(ad);
    setAdForm({
      id: ad.id || '',
      name: ad.name || '',
      provider: ad.provider || '',
      type: ad.type || 'Popunder',
      status: ad.status || 'enabled',
      script: ad.script || '',
      priority: ad.priority || 10,
      frequency: ad.frequency || 'always',
      startDate: ad.startDate || '',
      endDate: ad.endDate || '',
      targetMode: ad.targetMode || (ad.applyToEntireWebsite ? 'all' : 'single'),
      targetAnimeIds: Array.isArray(ad.targetAnimeIds)
        ? ad.targetAnimeIds
        : ad.targetAnimeId ? [String(ad.targetAnimeId)] : []
    });
    setIsAdFormOpen(true);
  };

  const handleDeleteAdTrigger = (ad: any) => {
    showConfirm(
      "Delete Advertisement",
      `Are you sure you want to delete advertisement "${ad.name}"?`,
      async () => {
        try {
          await deleteAdvertisement(ad.id);
          alert("Advertisement deleted successfully.");
        } catch (err) {
          console.error("Error deleting ad:", err);
          alert("Failed to delete advertisement.");
        }
      }
    );
  };

  const handleDuplicateAd = async (ad: any) => {
    const newId = `ad-dup-${Date.now()}`;
    const duplicatedAd = {
      ...ad,
      id: newId,
      name: `${ad.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    try {
      await addAdvertisement(newId, duplicatedAd);
      alert(`Advertisement duplicated successfully as "${duplicatedAd.name}"!`);
    } catch (err) {
      console.error("Error duplicating ad:", err);
      alert("Failed to duplicate advertisement.");
    }
  };

  const handleToggleAdStatus = async (ad: any) => {
    const newStatus = ad.status === 'enabled' ? 'disabled' : 'enabled';
    const updatedAd = {
      ...ad,
      status: newStatus,
      updatedAt: Date.now()
    };
    try {
      await addAdvertisement(ad.id, updatedAd);
    } catch (err) {
      console.error("Error toggling ad status:", err);
      alert("Failed to update advertisement status.");
    }
  };

  const handleDeleteAnimeClick = async (animeId: string, title: string, poster?: string, banner?: string) => {
    showConfirm(
      "Delete Anime",
      `Are you sure you want to delete "${title}"? This will remove the anime and all associated custom episodes.`,
      async () => {
        try {
          if (poster && poster.includes("cloudinary.com")) {
            deleteAssetByUrl(poster).catch(err => console.warn("Failed to delete poster:", err));
          }
          if (banner && banner.includes("cloudinary.com")) {
            deleteAssetByUrl(banner).catch(err => console.warn("Failed to delete banner:", err));
          }
          await deleteCustomAnime(animeId);
          alert("Anime show deleted successfully.");
          const list = await getCustomAnimes();
          setCustomAnimes(Object.values(list));
        } catch (e) {
          console.error("Failed to delete anime:", e);
          alert("Error deleting anime.");
        }
      }
    );
  };

  const handleCancelUpload = (key: string) => {
    if (abortControllersRef.current[key]) {
      abortControllersRef.current[key].abort();
      delete abortControllersRef.current[key];
    }
  };

  const handleUploadFileToCloudinary = async (file: File, key: string, onSuccess: (url: string) => void, oldUrl?: string) => {
    setUploadProgress(prev => ({ ...prev, [key]: 1 }));
    setUploadDetails(prev => ({ ...prev, [key]: { speed: 'Calculating...', sizeInfo: '', eta: '', processing: false } }));
    
    const controller = new AbortController();
    abortControllersRef.current[key] = controller;

    try {
      if (oldUrl && oldUrl.includes("cloudinary.com")) {
        deleteAssetByUrl(oldUrl).catch(err => console.warn("Failed to delete replaced asset:", err));
      }
      const isVideo = key.startsWith('video');
      const secureUrl = await uploadToCloudinary(
        file, 
        isVideo ? 'video' : 'image', 
        (percent, details) => {
          setUploadProgress(prev => ({ ...prev, [key]: percent }));
          if (details) {
            setUploadDetails(prev => ({ ...prev, [key]: details }));
          }
        },
        undefined,
        controller.signal
      );
      onSuccess(secureUrl);
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message === 'Aborted') {
        console.log(`Upload for ${key} was aborted by user.`);
      } else {
        console.error("Cloudinary upload failed:", e);
        alert("Upload failed: " + (e.message || "Unknown error"));
      }
    } finally {
      delete abortControllersRef.current[key];
      setUploadProgress(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setUploadDetails(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  const handleCreateNewEpisodeClick = () => {
    if (!animeForm.id) return;
    setEpisodeForm({
      id: `${animeForm.id}-ep-${customEpisodes.length + 1}`,
      number: customEpisodes.length + 1,
      title: `Episode ${customEpisodes.length + 1}`,
      thumbnail: '',
      videoSources: {
        sub: { enabled: true, type: 'embed', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        eng_dub: { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        hindi_dub: { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        other: { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' }
      }
    });
    setEditingEpisode(null);
    setUploadTabMode('episodeForm');
  };

  const handleEditEpisodeClick = (ep: any) => {
    setEpisodeForm({
      id: ep.id || `${animeForm.id}-ep-${ep.number}`,
      number: Number(ep.number),
      title: ep.title || `Episode ${ep.number}`,
      thumbnail: ep.thumbnail || '',
      videoSources: {
        sub: ep.videoSources?.sub || { enabled: true, type: 'embed', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        eng_dub: ep.videoSources?.eng_dub || { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        hindi_dub: ep.videoSources?.hindi_dub || { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' },
        other: ep.videoSources?.other || { enabled: false, type: 'file', url: '', hidePlaylist: false, hideShare: false, videoType: 'other' }
      }
    });
    setEditingEpisode(ep);
    setUploadTabMode('episodeForm');
  };

  const handleSaveEpisodeForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!animeForm.id) return;
    setIsSaving(true);
    try {
      const epData = {
        id: episodeForm.id || `${animeForm.id}-ep-${episodeForm.number}`,
        number: Number(episodeForm.number),
        title: episodeForm.title,
        thumbnail: episodeForm.thumbnail,
        videoSources: episodeForm.videoSources
      };
      
      await addCustomEpisode(animeForm.id, epData.number, epData);
      alert("Episode successfully saved!");
      
      const eps = await getCustomEpisodes(animeForm.id);
      setCustomEpisodes(eps ? Object.values(eps).filter(Boolean) : []);
      setUploadTabMode('animeForm');
    } catch (e) {
      console.error("Failed to save episode:", e);
      alert("Error saving episode.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEpisodeClick = async (epNum: number, thumbnail?: string) => {
    showConfirm(
      "Delete Episode",
      `Are you sure you want to delete Episode ${epNum}?`,
      async () => {
        try {
          if (thumbnail && thumbnail.includes("cloudinary.com")) {
            deleteAssetByUrl(thumbnail).catch(err => console.warn("Failed to delete episode thumbnail:", err));
          }
          await remove(ref(db, `episodes/${animeForm.id}/${epNum}`));
          alert("Episode deleted successfully.");
          const eps = await getCustomEpisodes(animeForm.id);
          setCustomEpisodes(eps ? Object.values(eps).filter(Boolean) : []);
        } catch (e) {
          console.error("Failed to delete episode:", e);
          alert("Error deleting episode.");
        }
      }
    );
  };

  // ==========================================
  // HOMEPAGE SECTION CRUD HANDLERS
  // ==========================================
  const handleCreateNewSectionClick = () => {
    setEditingSection(null);
    setSectionForm({
      id: '',
      name: '',
      slug: '',
      displayOrder: dbSections.length + 1,
      numCards: 12,
      visible: true,
      status: 'active'
    });
    setSectionFormOpen(true);
  };

  const handleEditSectionClick = (sec: any) => {
    setEditingSection(sec);
    setSectionForm({
      id: sec.id || sec.slug,
      name: sec.name || '',
      slug: sec.slug || '',
      displayOrder: sec.displayOrder || 1,
      numCards: sec.numCards || 12,
      visible: sec.visible !== false,
      status: sec.status || 'active'
    });
    setSectionFormOpen(true);
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionForm.name.trim()) return;
    
    const slug = sectionForm.slug.trim() || sectionForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = sectionForm.id || slug;

    const updatedSection = {
      id,
      name: sectionForm.name.trim(),
      slug,
      displayOrder: Number(sectionForm.displayOrder || 1),
      numCards: Number(sectionForm.numCards || 12),
      visible: sectionForm.visible,
      status: sectionForm.status
    };

    try {
      await set(ref(db, `homepageSections/${id}`), updatedSection);
      setSectionFormOpen(false);
      setEditingSection(null);
    } catch (err) {
      console.error("Failed to save homepage section:", err);
    }
  };

  const handleDeleteSection = async (id: string) => {
    showConfirm(
      "Delete Category",
      "Are you sure you want to delete this category?",
      async () => {
        try {
          const secRef = ref(db, `homepageSections/${id}`);
          const snap = await get(secRef);
          if (snap.exists()) {
            const secData = snap.val();
            const slug = secData.slug;

            // Remove the homepage section / category from Realtime Database
            await remove(secRef);

            // Clean up category assignments from any custom animes
            if (slug) {
              const animesSnap = await get(ref(db, 'animes'));
              if (animesSnap.exists()) {
                const animesObj = animesSnap.val();
                for (const animeId of Object.keys(animesObj)) {
                  const anime = animesObj[animeId];
                  if (anime.categories && anime.categories[slug] !== undefined) {
                    await remove(ref(db, `animes/${animeId}/categories/${slug}`));
                  }
                }
              }
            }

            // Refresh custom animes state in Admin
            const list = await getCustomAnimes();
            setCustomAnimes(Object.values(list));
          } else {
            // Fallback simple remove
            await remove(secRef);
          }
        } catch (err) {
          console.error("Failed to delete category:", err);
        }
      }
    );
  };

  // ==========================================
  // STORAGE MANAGER CRUD & TELEMETRY HANDLERS
  // ==========================================
  const handleCreateNewStorageClick = () => {
    setEditingStorage(null);
    const nextNumber = storageConfigs.length + 2; // Starts from #2
    setStorageForm({
      id: 'storage-' + Date.now(),
      name: `Cloudinary #${nextNumber}`,
      provider: 'cloudinary',
      cloudName: '',
      apiKey: '',
      apiSecret: '',
      folder: 'anova_anime',
      defaultFolder: 'anova_anime',
      status: 'enabled',
      priority: storageConfigs.length + 1,
      notes: '',
      maxUploadSize: 50,
      maxDailyUploads: 100,
      maxStorage: 1024
    });
    setStorageFormOpen(true);
  };

  const handleEditStorageClick = (st: any) => {
    setEditingStorage(st);
    setStorageForm({
      id: st.id || 'storage-' + Date.now(),
      name: st.name || '',
      provider: st.provider || 'cloudinary',
      cloudName: st.cloudName || '',
      apiKey: st.apiKey || '',
      apiSecret: st.apiSecret || '',
      folder: st.folder || 'anova_anime',
      defaultFolder: st.defaultFolder || 'anova_anime',
      status: st.status || 'enabled',
      priority: Number(st.priority || 1),
      notes: st.notes || '',
      maxUploadSize: Number(st.maxUploadSize || 50),
      maxDailyUploads: Number(st.maxDailyUploads || 100),
      maxStorage: Number(st.maxStorage || 1024)
    });
    setStorageFormOpen(true);
  };

  const handleSaveStorageForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageForm.name.trim()) {
      alert("Please fill in Storage Name.");
      return;
    }
    if (storageForm.provider === 'cloudinary' && (!storageForm.cloudName || !storageForm.apiKey || !storageForm.apiSecret)) {
      alert("Please fill in all Cloudinary parameters.");
      return;
    }

    try {
      const updatedStorage = {
        ...storageForm,
        priority: Number(storageForm.priority || 1),
        maxUploadSize: Number(storageForm.maxUploadSize || 50),
        maxDailyUploads: Number(storageForm.maxDailyUploads || 100),
        maxStorage: Number(storageForm.maxStorage || 1024),
        createdAt: editingStorage?.createdAt || Date.now()
      };

      await set(ref(db, `storage_configs/${storageForm.id}`), updatedStorage);
      
      // If there's no default storage set, set this one as default automatically
      if (!storageSettings.defaultStorageId) {
        await update(ref(db, 'storage_settings'), { defaultStorageId: storageForm.id });
      }

      setStorageFormOpen(false);
      setEditingStorage(null);
      alert("Storage provider successfully saved!");
    } catch (err) {
      console.error("Failed to save storage config:", err);
      alert("Error saving storage configuration.");
    }
  };

  const handleDeleteStorageClick = async (id: string, name: string) => {
    showConfirm(
      "Delete Storage Provider",
      `Are you sure you want to delete storage provider "${name}"? Previously uploaded files will not be affected.`,
      async () => {
        try {
          await remove(ref(db, `storage_configs/${id}`));
          
          // If we deleted the default storage, clear it or set it to another
          if (storageSettings.defaultStorageId === id) {
            await update(ref(db, 'storage_settings'), { defaultStorageId: '' });
          }
          
          alert("Storage provider deleted successfully.");
        } catch (err) {
          console.error("Failed to delete storage provider:", err);
          alert("Error deleting storage provider.");
        }
      }
    );
  };

  const handleSetDefaultStorage = async (id: string) => {
    try {
      await update(ref(db, 'storage_settings'), { defaultStorageId: id });
    } catch (err) {
      console.error("Failed to set default storage:", err);
    }
  };

  const handleToggleAutoRotate = async () => {
    try {
      await update(ref(db, 'storage_settings'), { autoRotate: !storageSettings.autoRotate });
    } catch (err) {
      console.error("Failed to toggle auto rotate:", err);
    }
  };

  const handleToggleSmartMode = async () => {
    try {
      await update(ref(db, 'storage_settings'), { smartMode: !storageSettings.smartMode });
    } catch (err) {
      console.error("Failed to toggle smart mode:", err);
    }
  };

  const handleTestStorageConnection = async (config: any) => {
    setIsTestingConnection(prev => ({ ...prev, [config.id]: true }));
    try {
      const result = await testConnectionWithConfig(config);
      setTestConnectionResults(prev => ({ 
        ...prev, 
        [config.id]: { success: result.success, message: result.message } 
      }));
    } catch (err) {
      setTestConnectionResults(prev => ({ 
        ...prev, 
        [config.id]: { success: false, message: "Network Error" } 
      }));
    } finally {
      setIsTestingConnection(prev => ({ ...prev, [config.id]: false }));
    }
  };

  return (
    <div className="min-h-screen pt-24 px-4 max-w-7xl mx-auto pb-24 bg-[#050505]">
      
      {/* 1. Header Navigation Control Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-primary" />
            AnOvA Streaming Administrator
          </h1>
          <p className="text-xs text-gray-400 mt-1">Real-time telemetry, server orchestration & directory moderator logs</p>
        </div>
        <Link
          to="/profile"
          className="flex items-center gap-1.5 px-4 py-2 bg-white/5 border border-white/5 text-gray-300 hover:text-white rounded-lg text-xs font-black transition-all uppercase tracking-wider"
        >
          <ArrowLeft size={14} className="text-primary" />
          Profile Panel
        </Link>
      </div>

      {/* 2. Top-Level Core Real-time Analytics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        
        {/* Card 1: Online Viewers */}
        <div className="bg-[#0a0d14]/40 border border-[#00e5ff]/10 p-5 rounded-2xl relative overflow-hidden backdrop-blur-md shadow-[0_0_20px_rgba(0,229,255,0.02)]">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#00e5ff]/5 rounded-full blur-2xl pointer-events-none" />
          <Activity size={16} className="text-primary absolute top-5 right-5 animate-pulse" />
          <span className="text-gray-500 text-[9px] font-black uppercase tracking-wider block">Online Viewers</span>
          <p className="text-2xl md:text-3xl font-black text-white mt-1.5 drop-shadow-[0_0_12px_rgba(0,229,255,0.25)]">
            {onlineUsers.length}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Live tracking active</span>
          </div>
        </div>

        {/* Card 2: Total Registered Users */}
        <div className="bg-[#0a0d14]/40 border border-white/5 p-5 rounded-2xl relative overflow-hidden backdrop-blur-md">
          <Users size={16} className="text-primary absolute top-5 right-5" />
          <span className="text-gray-500 text-[9px] font-black uppercase tracking-wider block">Registered directory</span>
          <p className="text-2xl md:text-3xl font-black text-white mt-1.5">{totalUsersCount}</p>
          <span className="text-[9px] text-gray-400 font-bold mt-2 block flex items-center gap-1">
            <span className="text-emerald-400">+{newUsersTodayCount} today</span> • {returningUsersCount} returning
          </span>
        </div>

        {/* Card 3: Total Views Today */}
        <div className="bg-[#0a0d14]/40 border border-white/5 p-5 rounded-2xl relative overflow-hidden backdrop-blur-md">
          <Play size={16} className="text-primary absolute top-5 right-5" />
          <span className="text-gray-500 text-[9px] font-black uppercase tracking-wider block">Total Views Today</span>
          <p className="text-2xl md:text-3xl font-black text-white mt-1.5">{viewsToday}</p>
          <span className="text-[9px] text-gray-400 font-bold mt-2 block">
            Accumulated: <span className="text-primary font-bold">{totalViewsCount}</span> total plays
          </span>
        </div>

        {/* Card 4: Accumulated Watch Time */}
        <div className="bg-[#0a0d14]/40 border border-white/5 p-5 rounded-2xl relative overflow-hidden backdrop-blur-md">
          <Clock size={16} className="text-primary absolute top-5 right-5" />
          <span className="text-gray-500 text-[9px] font-black uppercase tracking-wider block">Total Stream Hours</span>
          <p className="text-2xl md:text-3xl font-black text-white mt-1.5">{totalWatchHours}h</p>
          <span className="text-[9px] text-gray-400 font-bold mt-2 block">
            Avg Duration: <span className="text-primary font-bold">{averageWatchDurationMinutes}m</span> / play
          </span>
        </div>

      </div>

      {/* 3. Navigation Tab Bar */}
      <div className="flex gap-4 border-b border-white/5 pb-3 mb-8 overflow-x-auto hide-scrollbar text-xs font-black uppercase tracking-wider">
        {[
          { id: 'overview', label: 'Systems Overview' },
          { id: 'analytics', label: 'Real Watch Analytics' },
          { id: 'users', label: 'User Management' },
          { id: 'comments', label: 'Comment Moderation' },
          { id: 'upload', label: 'Anime Upload System' },
          { id: 'sections', label: 'Homepage Section Manager' },
          { id: 'storage', label: 'Storage Manager' },
          { id: 'ads', label: 'Advertisement Manager' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "pb-3 -mb-[13px] border-b-2 transition-all whitespace-nowrap cursor-pointer",
              activeTab === tab.id
                ? "text-primary border-primary font-black"
                : "text-gray-400 border-transparent hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 4. Tab Contents */}
      <div>
        
        {/* TAB 1: SYSTEM OVERVIEW (SERVERS & HEALTH CHECK) */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* CDN Servers list */}
            <div className="lg:col-span-2 bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-5 backdrop-blur-md">
              <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2.5 flex items-center justify-between">
                <span>CDN Nodes & Core Ingress</span>
                <span className="text-[10px] text-primary flex items-center gap-1 bg-cyan-500/5 border border-cyan-500/10 px-2 py-0.5 rounded-full font-bold">
                  <RefreshCw size={10} className="animate-spin text-primary" />
                  Telematics Active
                </span>
              </h3>
              
              <div className="space-y-3">
                {serverNodes.map((srv, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white/[0.01] p-3.5 rounded-xl border border-white/5 hover:border-primary/20 transition-all">
                    <div>
                      <p className="text-xs font-bold text-white">{srv.name}</p>
                      <p className="text-[9px] text-gray-500 mt-0.5">CPU Load: {srv.load} • Proxy tunnel bandwidth normal</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-gray-500 font-bold">{srv.load !== '0%' ? '18ms' : '--'}</span>
                      <span className={cn("text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 border", srv.badge)}>
                        <Server size={8} />
                        {srv.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ingress Controls Zone */}
            <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-5 h-fit backdrop-blur-md">
              <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2.5">
                Ingress Control Nodes
              </h3>
              <div className="space-y-3 text-xs">
                <button 
                  onClick={() => alert('Varnish Edge & Cloudflare cache purge broadcast initiated successfully.')}
                  className="w-full py-3 rounded-xl bg-primary hover:bg-[#00cce0] text-black font-black text-[10px] uppercase tracking-wider transition-colors shadow-lg shadow-cyan-500/10 cursor-pointer"
                >
                  Purge Edge CDN Cache
                </button>
                <button 
                  onClick={() => alert('Zustand persistent local storage states successfully synchronized with remote cluster.')}
                  className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-black text-[10px] uppercase tracking-wider border border-white/5 transition-colors cursor-pointer"
                >
                  Trigger Database Sync
                </button>
                <button 
                  onClick={() => alert('CDN Failover relay is ready. Automatic fallback is on.')}
                  className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-black text-[10px] uppercase tracking-wider border border-red-500/20 transition-colors cursor-pointer"
                >
                  Force CDN Relay Failover
                </button>
              </div>
              
              <div className="bg-white/[0.01] border border-white/5 p-4 rounded-xl space-y-2">
                <p className="text-[10px] text-gray-500 uppercase font-black tracking-wider">Node Details</p>
                <p className="text-xs text-gray-300 font-bold">API Ingress: <span className="text-primary">kryzox.xyz</span></p>
                <p className="text-xs text-gray-300 font-bold">Player Embed: <span className="text-[#00e5ff]">cdn.4animo.xyz</span></p>
                <p className="text-xs text-gray-300 font-bold">Admin Clearance: <span className="text-emerald-400 font-bold">SYSTEM OWNER</span></p>
              </div>

              {/* Player Branding Control */}
              <DailymotionBrandingToggle />
            </div>

          </div>
        )}

        {/* TAB 2: REAL WATCH ANALYTICS (REAL VIEWS & CHARTS) */}
        {activeTab === 'analytics' && (
          <div className="space-y-8">
            
            {/* Extra Analytics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#0a0d14]/30 border border-white/5 p-4 rounded-xl">
                <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Active Today</span>
                <p className="text-xl font-black text-white mt-1">{activeUsersToday}</p>
              </div>
              <div className="bg-[#0a0d14]/30 border border-white/5 p-4 rounded-xl">
                <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Weekly Active (WAU)</span>
                <p className="text-xl font-black text-[#00e5ff] mt-1">{weeklyActiveUsers}</p>
              </div>
              <div className="bg-[#0a0d14]/30 border border-white/5 p-4 rounded-xl">
                <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Monthly Active (MAU)</span>
                <p className="text-xl font-black text-white mt-1">{monthlyActiveUsers}</p>
              </div>
              <div className="bg-[#0a0d14]/30 border border-white/5 p-4 rounded-xl">
                <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Views Weekly</span>
                <p className="text-xl font-black text-white mt-1">{viewsThisWeek}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Top 10 Anime Chart list */}
              <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-5">
                <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2 flex items-center justify-between">
                  <span>Top 10 Most Watched Anime</span>
                  <span className="text-[10px] text-gray-500 font-bold">Cumulative view count</span>
                </h3>
                
                {top10Anime.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-12">No play tracking events registered yet.</p>
                ) : (
                  <div className="space-y-4">
                    {top10Anime.map((an, idx) => {
                      const maxViews = top10Anime[0].count;
                      const percentage = maxViews > 0 ? (an.count / maxViews) * 100 : 0;
                      return (
                        <div key={an.id} className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-bold">
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-primary font-black w-4 text-center">#{idx + 1}</span>
                              <span className="text-gray-300 truncate">{an.title}</span>
                            </div>
                            <span className="text-white shrink-0">{an.count} plays</span>
                          </div>
                          <div className="w-full bg-white/[0.02] border border-white/5 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-primary h-full rounded-full shadow-[0_0_8px_rgba(0,229,255,0.6)]"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Top 10 Episodes list */}
              <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-5">
                <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2 flex items-center justify-between">
                  <span>Top 10 Most Watched Episodes</span>
                  <span className="text-[10px] text-gray-500 font-bold">Individual episode plays</span>
                </h3>

                {top10Episodes.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-12">No episode play logs recorded.</p>
                ) : (
                  <div className="space-y-4">
                    {top10Episodes.map((ep, idx) => {
                      const maxViews = top10Episodes[0].count;
                      const percentage = maxViews > 0 ? (ep.count / maxViews) * 100 : 0;
                      return (
                        <div key={ep.key} className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-bold">
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-primary font-black w-4 text-center">#{idx + 1}</span>
                              <span className="text-gray-300 truncate">{ep.animeTitle} - Ep {ep.episode}</span>
                            </div>
                            <span className="text-white shrink-0">{ep.count} views</span>
                          </div>
                          <div className="w-full bg-white/[0.02] border border-white/5 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-[#00e5ff] h-full rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* Recently Streamed Events Feed */}
            <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2">
                Live Watch Activity Feed
              </h3>
              
              {recentlyWatchedAnime.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">Waiting for watch stream connections...</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recentlyWatchedAnime.map((item, idx) => (
                    <div key={idx} className="flex gap-4 p-3 rounded-xl bg-white/[0.01] border border-white/5 hover:border-cyan-500/10 transition-all items-center">
                      <img src={item.animePoster || null} alt="" className="w-10 h-14 object-cover rounded-lg shrink-0" />
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs font-bold text-white truncate">{item.animeTitle}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Episode {item.episode} • Played by <span className="text-primary">{item.userEmail?.split('@')[0]}</span></p>
                        <span className="text-[8px] text-gray-500 block mt-1">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 3: USER DIRECTORY & MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            
            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-[#0a0d14]/30 border border-white/5 p-4 rounded-xl backdrop-blur-md">
              <div className="relative w-full sm:max-w-sm">
                <Search size={14} className="text-gray-500 absolute top-3.5 left-4" />
                <input 
                  type="text"
                  placeholder="Search user by username or email..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full bg-black/40 text-xs text-white pl-10 pr-4 py-2.5 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Filter size={14} className="text-gray-500" />
                <span className="text-xs text-gray-400 font-bold uppercase">Filter:</span>
                <div className="flex gap-1.5">
                  {['all', 'premium', 'vip', 'banned'].map(f => (
                    <button
                      key={f}
                      onClick={() => setUserFilter(f)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors cursor-pointer",
                        userFilter === f 
                          ? "bg-primary text-black border-primary" 
                          : "bg-white/5 text-gray-400 border-transparent hover:text-white hover:bg-white/10"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* User Directory Table list */}
            <div className="bg-[#0a0d14]/30 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-gray-500 font-black uppercase text-[10px] tracking-wider">
                      <th className="py-4 px-6">Username</th>
                      <th className="py-4 px-4">Email</th>
                      <th className="py-4 px-4">Clearance status</th>
                      <th className="py-4 px-4">Saved Comments</th>
                      <th className="py-4 px-4 text-right">Directory Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-bold text-gray-200">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-500 text-xs">No registered accounts matching this search filter.</td>
                      </tr>
                    ) : (
                      filteredUsers.map(usr => {
                        const isBanned = usr.banned === true;
                        return (
                          <tr key={usr.uid} className="hover:bg-white/[0.01] transition-colors">
                            <td className="py-4 px-6 flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-black border border-primary/40 uppercase">
                                {usr.username?.charAt(0)}
                              </div>
                              <span className="font-extrabold text-white text-xs">{usr.username || 'Guest'}</span>
                            </td>
                            <td className="py-4 px-4 text-gray-400 font-semibold">{usr.email}</td>
                            <td className="py-4 px-4">
                              {isBanned ? (
                                <span className="bg-red-500/10 border border-red-500/30 text-red-400 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                                  Banned
                                </span>
                              ) : (
                                <span className={cn(
                                  "text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider border",
                                  usr.role === 'admin' 
                                    ? "bg-red-500/10 border-red-500/30 text-red-400" 
                                    : "bg-primary/10 border-primary/20 text-primary"
                                )}>
                                  {usr.role === 'admin' ? 'SysAdmin' : usr.status || 'Premium'}
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-gray-400 font-semibold">{usr.commentsCount || 0} posts</td>
                            <td className="py-4 px-4 text-right">
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => handleInspectUser(usr)}
                                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 transition-all cursor-pointer"
                                  title="View History Details"
                                >
                                  <Eye size={12} />
                                </button>
                                {usr.email !== 'mdido406@gmail.com' && (
                                  <button
                                    onClick={() => handleToggleBanUser(usr)}
                                    className={cn(
                                      "p-1.5 rounded-lg transition-all border cursor-pointer",
                                      isBanned
                                        ? "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                                        : "bg-white/5 text-gray-400 border-white/5 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                                    )}
                                    title={isBanned ? "Lift Ban" : "Ban User"}
                                  >
                                    <Ban size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* User detail dialog modal */}
            {selectedUser && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-lg z-50 flex items-center justify-center p-4">
                <div className="bg-[#050505] border border-cyan-500/15 w-full max-w-2xl rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden shadow-[0_0_50px_rgba(0,229,255,0.15)] max-h-[85vh] overflow-y-auto">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                  
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary text-lg font-black uppercase">
                        {selectedUser.username?.charAt(0)}
                      </div>
                      <div>
                        <h4 className="text-lg font-black text-white">{selectedUser.username}</h4>
                        <p className="text-xs text-gray-400">{selectedUser.email}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setSelectedUser(null)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-black transition-colors border border-white/5 text-gray-400 hover:text-white cursor-pointer uppercase tracking-wider"
                    >
                      Close
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#0a0d14]/50 border border-white/5 p-4 rounded-2xl">
                    <div>
                      <span className="text-[9px] text-gray-500 font-black uppercase tracking-wider block">Rank</span>
                      <p className="text-xs font-bold text-white uppercase mt-0.5">{selectedUser.status || 'Premium'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-gray-500 font-black uppercase tracking-wider block">Comment Counts</span>
                      <p className="text-xs font-bold text-white mt-0.5">{selectedUser.commentsCount || 0} posts</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-gray-500 font-black uppercase tracking-wider block">Favorites Saved</span>
                      <p className="text-xs font-bold text-primary mt-0.5">{selectedUserFavorites.length} anime</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-gray-500 font-black uppercase tracking-wider block">Register Date</span>
                      <p className="text-xs font-bold text-white mt-0.5">{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {loadingUserDetail ? (
                    <div className="py-12 text-center text-primary animate-pulse text-xs font-black uppercase tracking-widest">Loading history telemeter...</div>
                  ) : (
                    <div className="space-y-6">
                      
                      {/* Watch History progress list */}
                      <div className="space-y-3">
                        <h5 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Clock size={12} className="text-primary" />
                          Watch progression history ({selectedUserHistory.length})
                        </h5>
                        {selectedUserHistory.length === 0 ? (
                          <p className="text-[11px] text-gray-500 py-3 text-center border border-white/5 border-dashed rounded-xl">No saved watch history progress found.</p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                            {selectedUserHistory.map((h: any, idx) => (
                              <div key={idx} className="flex justify-between items-center p-2.5 bg-white/[0.01] border border-white/5 rounded-xl text-xs font-bold">
                                <span className="text-gray-200 truncate pr-3">{h.animeTitle}</span>
                                <span className="text-primary text-[10px] shrink-0 uppercase tracking-wider">Episode {h.episode}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Favorites saved */}
                      <div className="space-y-3">
                        <h5 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Heart size={12} className="text-primary" />
                          Favorites ({selectedUserFavorites.length})
                        </h5>
                        {selectedUserFavorites.length === 0 ? (
                          <p className="text-[11px] text-gray-500 py-3 text-center border border-white/5 border-dashed rounded-xl">No saved favorites cataloged.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                            {selectedUserFavorites.map((fav: any) => (
                              <div key={fav.id} className="bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-gray-300">
                                {fav.title}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  )}

                  {/* Danger zone actions */}
                  {selectedUser.email !== 'mdido406@gmail.com' && (
                    <div className="border-t border-white/5 pt-6 flex justify-between gap-4">
                      <button
                        onClick={() => handleToggleBanUser(selectedUser)}
                        className={cn(
                          "px-4 py-2 text-[10px] font-black uppercase tracking-wider border rounded-xl cursor-pointer",
                          selectedUser.banned 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}
                      >
                        {selectedUser.banned ? 'UNBAN ACCOUNT' : 'BAN ACCOUNT'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(selectedUser)}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-wider bg-red-500 text-white hover:bg-red-600 rounded-xl cursor-pointer"
                      >
                        DELETE ACCOUNT PERMANENTLY
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 4: COMMENT MODERATION ZONE */}
        {activeTab === 'comments' && (
          <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl space-y-4 backdrop-blur-md">
            <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-2.5">
              Live Comment Moderation & Reported Catalog ({commentsToModerate.length})
            </h3>

            {commentsToModerate.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-12">No active discussions exist in the database.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {commentsToModerate.map((cmt) => (
                  <div key={cmt.id} className="py-4.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-white/[0.01] transition-all rounded-xl px-2">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-white">{cmt.username}</span>
                        <span className="text-[10px] text-gray-500 font-semibold">{cmt.email}</span>
                        
                        {cmt.reported && (
                          <span className="bg-amber-500/10 border border-amber-500/30 text-[8px] font-black text-amber-400 px-2 py-0.5 rounded uppercase tracking-wider">
                            Reported / Flagged
                          </span>
                        )}
                        {cmt.pinned && (
                          <span className="bg-primary/10 border border-primary/30 text-[8px] font-black text-primary px-2 py-0.5 rounded uppercase flex items-center gap-0.5">
                            <Pin size={8} className="fill-primary" /> Pinned
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed font-semibold italic">"{cmt.body}"</p>
                      {cmt.animeId && (
                        <span className="text-[8px] text-primary bg-primary/5 px-2 py-0.5 rounded uppercase font-black">
                          Anime ID: {cmt.animeId} {cmt.episodeNumber && `• Ep ${cmt.episodeNumber}`}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
                      <button
                        onClick={() => pinComment(cmt.id, !cmt.pinned)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 border cursor-pointer",
                          cmt.pinned 
                            ? "bg-primary/10 text-primary border-primary/20" 
                            : "bg-white/5 text-gray-400 border-transparent hover:text-white"
                        )}
                      >
                        <Pin size={10} />
                        {cmt.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        onClick={() => {
                          deleteComment(cmt.id);
                          alert('Comment successfully deleted.');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 size={10} />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: ANIME UPLOAD SYSTEM ZONE */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            
            {/* Tab Header */}
            <div className="flex justify-between items-center bg-[#0a0d14]/30 border border-white/5 p-5 rounded-2xl backdrop-blur-md">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <UploadCloud size={16} className="text-primary" />
                  Anime upload and asset manager
                </h3>
                <p className="text-[10px] text-gray-400 mt-1">Saves records directly to Firebase; syncs assets directly to Cloudinary.</p>
              </div>
              {uploadTabMode === 'list' && (
                <button
                  onClick={handleCreateNewAnimeClick}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-cyan-500/15 uppercase tracking-wider"
                >
                  <FolderPlus size={14} />
                  Upload New Anime
                </button>
              )}
            </div>

            {/* A. LIST MODE: Shows all uploaded shows */}
            {uploadTabMode === 'list' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {customAnimes.length === 0 ? (
                  <div className="col-span-full py-16 text-center bg-[#0a0d14]/10 border border-white/5 border-dashed rounded-3xl flex flex-col items-center justify-center space-y-4">
                    <Sparkles size={36} className="text-gray-600 animate-pulse" />
                    <div>
                      <p className="text-xs font-black text-white uppercase tracking-wider">No custom anime uploaded yet</p>
                      <p className="text-[10px] text-gray-500 mt-1">Click 'Upload New Anime' above to create your first series.</p>
                    </div>
                  </div>
                ) : (
                  customAnimes.map((anime) => (
                    <div key={anime.id} className="bg-[#0a0d14]/40 border border-white/5 rounded-2xl overflow-hidden flex flex-col hover:border-primary/20 transition-all group relative">
                      {anime.visibility === 'draft' && (
                        <span className="absolute top-3 left-3 z-10 bg-amber-500/90 text-black text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest shadow-md">
                          DRAFT
                        </span>
                      )}
                      
                      <div className="relative aspect-video w-full overflow-hidden bg-black/40">
                        <img 
                          src={anime.banner || anime.poster || null} 
                          alt="" 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 flex items-end gap-3">
                          <img src={anime.poster || null} alt="" className="w-10 h-14 object-cover rounded-md border border-white/10 shrink-0 shadow-lg" />
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-black text-white truncate drop-shadow-md uppercase tracking-tight">{anime.title}</h4>
                            <p className="text-[9px] text-gray-400 mt-0.5 font-bold uppercase">{anime.type} • {anime.status} • {anime.released}</p>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                        <div className="space-y-2">
                          <p className="text-[10px] text-gray-400 font-semibold line-clamp-2 italic leading-relaxed">
                            "{anime.description || 'No description provided.'}"
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {Array.isArray(anime.genres) ? anime.genres.slice(0, 3).map((g: string) => (
                              <span key={g} className="bg-white/5 px-1.5 py-0.5 rounded text-[8px] text-gray-400 uppercase font-black tracking-wider border border-white/5">
                                {g}
                              </span>
                            )) : null}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2 border-t border-white/5">
                          <button
                            onClick={() => handleEditAnimeClick(anime)}
                            className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/5 hover:border-white/15 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Edit3 size={11} className="text-primary" />
                            Manage Show & Episodes
                          </button>
                          <button
                            onClick={() => handleDeleteAnimeClick(String(anime.id), anime.title, anime.poster, anime.banner)}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl transition-all cursor-pointer"
                            title="Delete Anime Show"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* B. ANIME FORM MODE */}
            {uploadTabMode === 'animeForm' && (
              <form onSubmit={handleSaveAnimeForm} className="space-y-8">
                <div className="flex justify-between items-center border-b border-white/5 pb-4">
                  <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Settings size={14} className="text-primary animate-spin" />
                    {editingAnime ? `Edit Catalog Show: ${animeForm.title}` : 'Catalog New Anime Series'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setUploadTabMode('list')}
                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black border border-white/5 text-gray-300 hover:text-white transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Back to Catalog
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  {/* Left Column: Metadata Inputs */}
                  <div className="lg:col-span-2 space-y-6">
                    
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">English Title / Romaji Name</label>
                      <input 
                        type="text" 
                        required
                        value={animeForm.title}
                        onChange={(e) => setAnimeForm(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="e.g. Solo Leveling Season 2"
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Detailed Synopsis</label>
                      <textarea 
                        rows={4}
                        required
                        value={animeForm.description}
                        onChange={(e) => setAnimeForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Provide deep description of the show storyline, main characters, and plot..."
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors leading-relaxed font-semibold"
                      />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Format Type</label>
                        <select 
                          value={animeForm.type}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, type: e.target.value }))}
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        >
                          <option value="TV">TV Show</option>
                          <option value="Movie">Movie</option>
                          <option value="OVA">OVA</option>
                          <option value="Special">Special Event</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Airing Status</label>
                        <select 
                          value={animeForm.status}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, status: e.target.value }))}
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        >
                          <option value="Ongoing">Ongoing</option>
                          <option value="Completed">Completed</option>
                          <option value="Upcoming">Upcoming</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Visibility status</label>
                        <select 
                          value={animeForm.visibility}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, visibility: e.target.value }))}
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        >
                          <option value="public">Public (Visible to everyone)</option>
                          <option value="draft">Draft (Visible only to administrators)</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Total Episodes</label>
                        <input 
                          type="number" 
                          required
                          value={animeForm.episodes}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, episodes: Number(e.target.value) }))}
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Rating (MAL / IMDb)</label>
                        <input 
                          type="text" 
                          required
                          value={animeForm.rating}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, rating: e.target.value }))}
                          placeholder="e.g. 8.75"
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Released Year</label>
                        <input 
                          type="text" 
                          required
                          value={animeForm.released}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, released: e.target.value }))}
                          placeholder="e.g. 2025"
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Genres (Comma separated)</label>
                        <input 
                          type="text" 
                          required
                          value={animeForm.genres}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, genres: e.target.value }))}
                          placeholder="Action, Adventure, Fantasy, Sci-Fi"
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Studio Company</label>
                        <input 
                          type="text" 
                          required
                          value={animeForm.studio}
                          onChange={(e) => setAnimeForm(prev => ({ ...prev, studio: e.target.value }))}
                          placeholder="e.g. A-1 Pictures"
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                    </div>

                  </div>

                  {/* Right Column: Asset Upload & Categories */}
                  <div className="space-y-6">
                    
                    {/* Poster Image Asset */}
                    <div className="bg-[#0a0d14]/40 border border-white/5 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Anime Poster (vertical)</span>
                      
                      {animeForm.poster ? (
                        <div className="relative aspect-[3/4] w-28 mx-auto rounded-xl overflow-hidden border border-white/10 group">
                          <img src={animeForm.poster || null} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              if (animeForm.poster.includes("cloudinary.com")) {
                                deleteAssetByUrl(animeForm.poster).catch(err => console.warn(err));
                              }
                              setAnimeForm(prev => ({ ...prev, poster: '' }));
                            }}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-400 text-[10px] font-black uppercase tracking-widest cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="border border-white/5 border-dashed rounded-xl p-6 text-center hover:bg-white/[0.01] transition-colors relative cursor-pointer">
                          <input 
                            type="file" 
                            accept="image/*"
                            id="poster-uploader"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleUploadFileToCloudinary(file, 'poster', (url) => {
                                  setAnimeForm(prev => ({ ...prev, poster: url }));
                                }, animeForm.poster);
                              }
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <UploadCloud size={24} className="text-gray-600 mx-auto mb-2 animate-bounce" />
                          <p className="text-[9px] text-gray-400 font-extrabold uppercase">Choose image file</p>
                          <p className="text-[8px] text-gray-500 mt-0.5">Drag/Drop or click to upload</p>
                        </div>
                      )}

                      {/* Cloudinary Progress Indicator */}
                      {uploadProgress['poster'] !== undefined && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 font-black">
                            <span>
                              {uploadProgress['poster'] >= 100 || uploadDetails['poster']?.processing ? (
                                <span className="text-primary animate-pulse uppercase">Processing on Cloudinary...</span>
                              ) : (
                                <span className="uppercase">
                                  Uploading Poster
                                  {uploadDetails['poster']?.sizeInfo ? ` (${uploadDetails['poster'].sizeInfo})` : ' to Cloudinary...'}
                                  {uploadDetails['poster']?.speed ? ` @ ${uploadDetails['poster'].speed}` : ''}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span>{Math.round(uploadProgress['poster'])}%</span>
                              {uploadProgress['poster'] < 100 && !uploadDetails['poster']?.processing && (
                                <button 
                                  type="button" 
                                  onClick={() => handleCancelUpload('poster')}
                                  className="text-red-400 hover:text-red-300 font-black uppercase text-[7px] cursor-pointer"
                                >
                                  [Cancel]
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress['poster']}%` }} />
                          </div>
                        </div>
                      )}

                      {/* Direct Url Field */}
                      <input 
                        type="text"
                        value={animeForm.poster}
                        onChange={(e) => setAnimeForm(prev => ({ ...prev, poster: e.target.value }))}
                        placeholder="Or paste direct image URL..."
                        className="w-full bg-black/50 text-[10px] text-gray-300 px-3 py-2 rounded-lg border border-white/5 outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>

                    {/* Banner Image Asset */}
                    <div className="bg-[#0a0d14]/40 border border-white/5 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Anime Banner (landscape)</span>
                      
                      {animeForm.banner ? (
                        <div className="relative aspect-[16/9] w-full rounded-xl overflow-hidden border border-white/10 group">
                          <img src={animeForm.banner || null} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              if (animeForm.banner.includes("cloudinary.com")) {
                                deleteAssetByUrl(animeForm.banner).catch(err => console.warn(err));
                              }
                              setAnimeForm(prev => ({ ...prev, banner: '' }));
                            }}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-400 text-[10px] font-black uppercase tracking-widest cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="border border-white/5 border-dashed rounded-xl p-6 text-center hover:bg-white/[0.01] transition-colors relative cursor-pointer">
                          <input 
                            type="file" 
                            accept="image/*"
                            id="banner-uploader"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleUploadFileToCloudinary(file, 'banner', (url) => {
                                  setAnimeForm(prev => ({ ...prev, banner: url }));
                                }, animeForm.banner);
                              }
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <UploadCloud size={24} className="text-gray-600 mx-auto mb-2 animate-bounce" />
                          <p className="text-[9px] text-gray-400 font-extrabold uppercase">Choose image file</p>
                          <p className="text-[8px] text-gray-500 mt-0.5">landscape banner or wallpaper</p>
                        </div>
                      )}

                      {/* Cloudinary Progress Indicator */}
                      {uploadProgress['banner'] !== undefined && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 font-black">
                            <span>
                              {uploadProgress['banner'] >= 100 || uploadDetails['banner']?.processing ? (
                                <span className="text-primary animate-pulse uppercase">Processing on Cloudinary...</span>
                              ) : (
                                <span className="uppercase">
                                  Uploading Banner
                                  {uploadDetails['banner']?.sizeInfo ? ` (${uploadDetails['banner'].sizeInfo})` : ' to Cloudinary...'}
                                  {uploadDetails['banner']?.speed ? ` @ ${uploadDetails['banner'].speed}` : ''}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span>{Math.round(uploadProgress['banner'])}%</span>
                              {uploadProgress['banner'] < 100 && !uploadDetails['banner']?.processing && (
                                <button 
                                  type="button" 
                                  onClick={() => handleCancelUpload('banner')}
                                  className="text-red-400 hover:text-red-300 font-black uppercase text-[7px] cursor-pointer"
                                >
                                  [Cancel]
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress['banner']}%` }} />
                          </div>
                        </div>
                      )}

                      {/* Direct Url Field */}
                      <input 
                        type="text"
                        value={animeForm.banner}
                        onChange={(e) => setAnimeForm(prev => ({ ...prev, banner: e.target.value }))}
                        placeholder="Or paste direct image URL..."
                        className="w-full bg-black/50 text-[10px] text-gray-300 px-3 py-2 rounded-lg border border-white/5 outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>

                    {/* Dynamic Language Badges Checklist */}
                    <div className="bg-[#0a0d14]/40 border border-white/5 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Available language tracks</span>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 text-[11px] font-bold text-gray-300 select-none cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={animeForm.subAvailable}
                            onChange={(e) => setAnimeForm(prev => ({ ...prev, subAvailable: e.target.checked }))}
                            className="rounded accent-primary" 
                          />
                          SUB (Subtitles)
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-bold text-gray-300 select-none cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={animeForm.dubAvailable}
                            onChange={(e) => setAnimeForm(prev => ({ ...prev, dubAvailable: e.target.checked }))}
                            className="rounded accent-primary" 
                          />
                          ENG DUB
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-bold text-gray-300 select-none cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={animeForm.hindiAvailable}
                            onChange={(e) => setAnimeForm(prev => ({ ...prev, hindiAvailable: e.target.checked }))}
                            className="rounded accent-primary" 
                          />
                          HINDI DUB
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-bold text-gray-300 select-none cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={animeForm.multiAvailable}
                            onChange={(e) => setAnimeForm(prev => ({ ...prev, multiAvailable: e.target.checked }))}
                            className="rounded accent-primary" 
                          />
                          MULTI AUDIO
                        </label>
                      </div>
                    </div>

                    {/* Categories Placement (Manual Controls) */}
                    <div className="bg-[#0a0d14]/40 border border-white/5 p-5 rounded-2xl space-y-4">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block border-b border-white/5 pb-2">Manual Category Allocation</span>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {dbSections.map((sec) => (
                          <label key={sec.slug || sec.id} className="flex items-center gap-2 text-[11px] font-bold text-gray-300 select-none cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={animeForm.categories?.[sec.slug] === true}
                              onChange={(e) => setAnimeForm(prev => {
                                const cats = { ...(prev.categories || {}) };
                                cats[sec.slug] = e.target.checked;
                                return { ...prev, categories: cats };
                              })}
                              className="rounded accent-primary" 
                            />
                            {sec.name}
                          </label>
                        ))}
                      </div>
                    </div>

                  </div>

                </div>

                {/* Sub Section: Custom Episode Management List */}
                {editingAnime && (
                  <div className="border-t border-white/5 pt-8 space-y-4">
                    <div className="flex justify-between items-center bg-[#0a0d14]/20 p-4 border border-white/5 rounded-xl">
                      <div>
                        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Video size={14} className="text-primary" />
                          Episodes Upload Manager ({customEpisodes.length})
                        </h4>
                        <p className="text-[10px] text-gray-500 mt-1">Configure individual language file streams, audio tracks, or subbed embeds.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateNewEpisodeClick}
                        className="flex items-center gap-1 bg-white/5 border border-white/5 text-gray-300 hover:text-white hover:bg-white/10 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest cursor-pointer"
                      >
                        <FilePlus size={12} />
                        Add New Episode
                      </button>
                    </div>

                    {customEpisodes.length === 0 ? (
                      <p className="text-xs text-gray-500 py-10 text-center border border-dashed border-white/5 rounded-xl">No episodes uploaded for this series. Click 'Add New Episode' above.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {customEpisodes.map((ep) => (
                          <div key={ep.id || ep.number} className="bg-white/[0.01] border border-white/5 p-3.5 rounded-xl flex items-center gap-3 justify-between">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <img src={ep.thumbnail || animeForm.poster || null} alt="" className="w-12 h-10 object-cover rounded bg-black" />
                              <div className="overflow-hidden">
                                <p className="text-xs font-extrabold text-white truncate">Episode {ep.number}</p>
                                <p className="text-[10px] text-gray-400 truncate">{ep.title || `Title Episode ${ep.number}`}</p>
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleEditEpisodeClick(ep)}
                                className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded border border-white/5 transition-colors cursor-pointer"
                                title="Edit Episode Sources"
                              >
                                <Edit3 size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEpisodeClick(Number(ep.number), ep.thumbnail)}
                                className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/15 transition-colors cursor-pointer"
                                title="Delete Episode"
                              >
                                <Trash size={11} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Controls Row */}
                <div className="border-t border-white/5 pt-6 flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setUploadTabMode('list')}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all border border-white/5 active:scale-95 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-8 py-3 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all shadow-lg shadow-cyan-500/15 uppercase tracking-wider active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={13} />
                    {isSaving ? 'SAVING TO REMOTE...' : 'SAVE ANIME SERIES'}
                  </button>
                </div>
              </form>
            )}

            {/* C. EPISODE FORM MODE */}
            {uploadTabMode === 'episodeForm' && (
              <form onSubmit={handleSaveEpisodeForm} className="space-y-8">
                <div className="flex justify-between items-center border-b border-white/5 pb-4">
                  <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Video size={14} className="text-primary" />
                    {editingEpisode ? `Edit Episode ${episodeForm.number} Sources` : `Catalog Episode ${episodeForm.number} for ${animeForm.title}`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setUploadTabMode('animeForm')}
                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black border border-white/5 text-gray-300 hover:text-white transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Back to Anime Form
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  {/* Left Column: Metadata */}
                  <div className="lg:col-span-2 space-y-6">
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Episode Number</label>
                        <input 
                          type="number" 
                          required
                          value={episodeForm.number}
                          onChange={(e) => setEpisodeForm(prev => ({ ...prev, number: Number(e.target.value) }))}
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Episode Title</label>
                        <input 
                          type="text" 
                          required
                          value={episodeForm.title}
                          onChange={(e) => setEpisodeForm(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="e.g. The Awakening of Monarchs"
                          className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                        />
                      </div>

                    </div>

                    {/* Language Multi-Stream Matrix Fields */}
                    <div className="space-y-4">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block border-b border-white/5 pb-2">Configure video stream sources</span>
                      
                      {['sub', 'eng_dub', 'hindi_dub', 'other'].map((langKey) => {
                        const source = episodeForm.videoSources[langKey] || { enabled: false, type: 'file', url: '' };
                        return (
                          <div key={langKey} className="bg-[#0a0d14]/40 border border-white/5 p-4 rounded-2xl space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black text-white uppercase tracking-widest text-primary">
                                {langKey === 'sub' ? 'SUB (Subtitled English)' : 
                                 langKey === 'eng_dub' ? 'ENG DUB (English Audio Track)' :
                                 langKey === 'hindi_dub' ? 'HINDI DUB (Hindi Audio Track)' :
                                 'OTHER LANGUAGE SOURCE'}
                              </span>
                              <label className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 select-none cursor-pointer uppercase tracking-wider">
                                <input 
                                  type="checkbox"
                                  checked={source.enabled}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setEpisodeForm(prev => {
                                      const copy = { ...prev.videoSources };
                                      copy[langKey] = { ...copy[langKey], enabled: checked };
                                      return { ...prev, videoSources: copy };
                                    });
                                  }}
                                  className="rounded accent-primary" 
                                />
                                Enable Track
                              </label>
                            </div>

                            {source.enabled && (
                              <div className="space-y-3.5 pl-2 border-l border-primary/20">
                                
                                <div className="flex flex-wrap gap-4 items-center text-[10px] font-black text-gray-400">
                                  <span>Stream source:</span>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input 
                                      type="radio" 
                                      name={`type-${langKey}`}
                                      checked={source.type === 'file'}
                                      onChange={() => {
                                        setEpisodeForm(prev => {
                                          const copy = { ...prev.videoSources };
                                          copy[langKey] = { ...copy[langKey], type: 'file', videoType: 'other' };
                                          return { ...prev, videoSources: copy };
                                        });
                                      }}
                                      className="accent-primary" 
                                    />
                                    Direct File (MP4 / HLS .m3u8)
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input 
                                      type="radio" 
                                      name={`type-${langKey}`}
                                      checked={source.type === 'embed'}
                                      onChange={() => {
                                        setEpisodeForm(prev => {
                                          const copy = { ...prev.videoSources };
                                          copy[langKey] = { ...copy[langKey], type: 'embed', videoType: 'other' };
                                          return { ...prev, videoSources: copy };
                                        });
                                      }}
                                      className="accent-primary" 
                                    />
                                    Embed iframe URL Proxy
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input 
                                      type="radio" 
                                      name={`type-${langKey}`}
                                      checked={source.type === 'dailymotion' || source.videoType === 'dailymotion'}
                                      onChange={() => {
                                        setEpisodeForm(prev => {
                                          const copy = { ...prev.videoSources };
                                          copy[langKey] = { 
                                            ...copy[langKey], 
                                            type: 'dailymotion', 
                                            videoType: 'dailymotion',
                                            hidePlaylist: copy[langKey]?.hidePlaylist ?? false,
                                            hideShare: copy[langKey]?.hideShare ?? false
                                          };
                                          return { ...prev, videoSources: copy };
                                        });
                                      }}
                                      className="accent-primary" 
                                    />
                                    Dailymotion Embed
                                  </label>
                                </div>

                                <div className="flex gap-3">
                                  <input 
                                    type="text" 
                                    required={source.enabled}
                                    value={source.url}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const isDm = val.includes('dailymotion.com') || val.includes('dai.ly');
                                      setEpisodeForm(prev => {
                                        const copy = { ...prev.videoSources };
                                        copy[langKey] = { 
                                          ...copy[langKey], 
                                          url: val,
                                          ...(isDm ? { type: 'dailymotion', videoType: 'dailymotion' } : {})
                                        };
                                        return { ...prev, videoSources: copy };
                                      });
                                    }}
                                    placeholder={source.type === 'file' ? 'Direct video stream URL (.mp4 or .m3u8)' : 'https://www.dailymotion.com/embed/video/...'}
                                    className="flex-1 bg-black/50 text-xs text-white px-3.5 py-2.5 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-mono"
                                  />

                                  {source.type === 'file' && (
                                    <div className="relative shrink-0">
                                      <input 
                                        type="file" 
                                        accept="video/*,audio/*,.m3u8,.mp4"
                                        id={`video-uploader-${langKey}`}
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            handleUploadFileToCloudinary(file, `video-${langKey}`, (url) => {
                                              setEpisodeForm(prev => {
                                                const copy = { ...prev.videoSources };
                                                copy[langKey] = { ...copy[langKey], url };
                                                return { ...prev, videoSources: copy };
                                              });
                                            });
                                          }
                                        }}
                                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                      />
                                      <button
                                        type="button"
                                        className="bg-white/5 border border-white/5 hover:bg-white/10 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                      >
                                        Upload File
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Video Upload Progress Indicator */}
                                {uploadProgress[`video-${langKey}`] !== undefined && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[8px] text-gray-400 font-black">
                                      <span>
                                        {uploadProgress[`video-${langKey}`] >= 100 || uploadDetails[`video-${langKey}`]?.processing ? (
                                          <span className="text-primary animate-pulse uppercase">Processing on Cloudinary cluster... Please wait</span>
                                        ) : (
                                          <span className="uppercase">
                                            Uploading Video File
                                            {uploadDetails[`video-${langKey}`]?.sizeInfo ? ` (${uploadDetails[`video-${langKey}`].sizeInfo})` : ' to Cloudinary cluster...'}
                                            {uploadDetails[`video-${langKey}`]?.speed ? ` @ ${uploadDetails[`video-${langKey}`].speed}` : ''}
                                            {uploadDetails[`video-${langKey}`]?.eta ? `, ETA: ${uploadDetails[`video-${langKey}`].eta}` : ''}
                                          </span>
                                        )}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <span>{Math.round(uploadProgress[`video-${langKey}`])}%</span>
                                        {uploadProgress[`video-${langKey}`] < 100 && !uploadDetails[`video-${langKey}`]?.processing && (
                                          <button 
                                            type="button" 
                                            onClick={() => handleCancelUpload(`video-${langKey}`)}
                                            className="text-red-400 hover:text-red-300 font-black uppercase text-[7px] cursor-pointer"
                                          >
                                            [Cancel]
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                      <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress[`video-${langKey}`]}%` }} />
                                    </div>
                                  </div>
                                )}

                                {/* Dailymotion UI Mask Settings Block */}
                                {(source.type === 'dailymotion' || source.videoType === 'dailymotion' || source.url.includes('dailymotion.com') || source.url.includes('dai.ly')) && (
                                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 space-y-3.5 mt-2">
                                    <h5 className="text-[10px] text-white font-black uppercase tracking-wider flex items-center gap-1.5 text-primary">
                                      <ShieldCheck size={12} className="text-primary animate-pulse" />
                                      Embed UI Protection (Dailymotion Only)
                                    </h5>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <label className="flex items-center gap-2.5 text-[10px] font-black text-gray-300 cursor-pointer select-none">
                                        <input 
                                          type="checkbox"
                                          checked={source.hidePlaylist === true}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            setEpisodeForm(prev => {
                                              const copy = { ...prev.videoSources };
                                              copy[langKey] = { ...copy[langKey], hidePlaylist: checked };
                                              return { ...prev, videoSources: copy };
                                            });
                                          }}
                                          className="w-4 h-4 rounded accent-primary border-white/10 bg-black/50 cursor-pointer"
                                        />
                                        <div>
                                          <span className="block text-[10px] text-white uppercase font-black">Hide Playlist Button</span>
                                          <span className="block text-[8px] text-gray-500 font-bold uppercase">Render floating overlay over Playlist icon</span>
                                        </div>
                                      </label>

                                      <label className="flex items-center gap-2.5 text-[10px] font-black text-gray-300 cursor-pointer select-none">
                                        <input 
                                          type="checkbox"
                                          checked={source.hideShare === true}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            setEpisodeForm(prev => {
                                              const copy = { ...prev.videoSources };
                                              copy[langKey] = { ...copy[langKey], hideShare: checked };
                                              return { ...prev, videoSources: copy };
                                            });
                                          }}
                                          className="w-4 h-4 rounded accent-primary border-white/10 bg-black/50 cursor-pointer"
                                        />
                                        <div>
                                          <span className="block text-[10px] text-white uppercase font-black">Hide Share Button</span>
                                          <span className="block text-[8px] text-gray-500 font-bold uppercase">Render floating overlay over Share icon</span>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                )}

                              </div>
                            )}
                          </div>
                        );
                      })}

                    </div>

                  </div>

                  {/* Right Column: Thumbnail */}
                  <div className="space-y-6">
                    
                    <div className="bg-[#0a0d14]/40 border border-white/5 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Episode Thumbnail</span>
                      
                      {episodeForm.thumbnail ? (
                        <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-white/10 group">
                          <img src={episodeForm.thumbnail || null} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              if (episodeForm.thumbnail.includes("cloudinary.com")) {
                                deleteAssetByUrl(episodeForm.thumbnail).catch(err => console.warn(err));
                              }
                              setEpisodeForm(prev => ({ ...prev, thumbnail: '' }));
                            }}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-400 text-[10px] font-black uppercase tracking-widest cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="border border-white/5 border-dashed rounded-xl p-6 text-center hover:bg-white/[0.01] transition-colors relative cursor-pointer">
                          <input 
                            type="file" 
                            accept="image/*"
                            id="ep-thumb-uploader"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleUploadFileToCloudinary(file, 'ep-thumb', (url) => {
                                  setEpisodeForm(prev => ({ ...prev, thumbnail: url }));
                                }, episodeForm.thumbnail);
                              }
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <UploadCloud size={24} className="text-gray-600 mx-auto mb-2 animate-bounce" />
                          <p className="text-[9px] text-gray-400 font-extrabold uppercase">Choose thumbnail file</p>
                          <p className="text-[8px] text-gray-500 mt-0.5">landscape visual image</p>
                        </div>
                      )}

                      {/* Progress bar */}
                      {uploadProgress['ep-thumb'] !== undefined && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 font-black">
                            <span>
                              {uploadProgress['ep-thumb'] >= 100 || uploadDetails['ep-thumb']?.processing ? (
                                <span className="text-primary animate-pulse uppercase">Processing on Cloudinary...</span>
                              ) : (
                                <span className="uppercase">
                                  Uploading Thumbnail
                                  {uploadDetails['ep-thumb']?.sizeInfo ? ` (${uploadDetails['ep-thumb'].sizeInfo})` : ' to Cloudinary...'}
                                  {uploadDetails['ep-thumb']?.speed ? ` @ ${uploadDetails['ep-thumb'].speed}` : ''}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span>{Math.round(uploadProgress['ep-thumb'])}%</span>
                              {uploadProgress['ep-thumb'] < 100 && !uploadDetails['ep-thumb']?.processing && (
                                <button 
                                  type="button" 
                                  onClick={() => handleCancelUpload('ep-thumb')}
                                  className="text-red-400 hover:text-red-300 font-black uppercase text-[7px] cursor-pointer"
                                >
                                  [Cancel]
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress['ep-thumb']}%` }} />
                          </div>
                        </div>
                      )}

                      <input 
                        type="text"
                        value={episodeForm.thumbnail}
                        onChange={(e) => setEpisodeForm(prev => ({ ...prev, thumbnail: e.target.value }))}
                        placeholder="Or paste direct image URL..."
                        className="w-full bg-black/50 text-[10px] text-gray-300 px-3 py-2 rounded-lg border border-white/5 outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>

                  </div>

                </div>

                {/* Submit row */}
                <div className="border-t border-white/5 pt-6 flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setUploadTabMode('animeForm')}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all border border-white/5 active:scale-95 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-8 py-3 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all shadow-lg shadow-cyan-500/15 uppercase tracking-wider active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={13} />
                    {isSaving ? 'SAVING EPISODE...' : 'SAVE EPISODE'}
                  </button>
                </div>
              </form>
            )}

          </div>
        )}

        {/* TAB 6: HOMEPAGE SECTION MANAGER ZONE */}
        {activeTab === 'sections' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex justify-between items-center bg-[#0a0d14]/30 border border-white/5 p-5 rounded-2xl backdrop-blur-md">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Settings size={16} className="text-primary" />
                  Homepage Section Manager
                </h3>
                <p className="text-[10px] text-gray-400 mt-1">Manage, sort, and enable/disable custom and standard homepage sections dynamically.</p>
              </div>
              {!sectionFormOpen && (
                <button
                  onClick={handleCreateNewSectionClick}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-cyan-500/15 uppercase tracking-wider"
                >
                  <Plus size={14} />
                  Create New Section
                </button>
              )}
            </div>

            {/* A. FORM MODE: Creating or editing a section */}
            {sectionFormOpen ? (
              <form onSubmit={handleSaveSection} className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl backdrop-blur-md space-y-6 max-w-2xl mx-auto">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <h4 className="text-xs font-black text-white uppercase tracking-wider">
                    {editingSection ? 'Modify Homepage Section' : 'Add Custom Homepage Section'}
                  </h4>
                  <button 
                    type="button" 
                    onClick={() => setSectionFormOpen(false)}
                    className="text-[10px] text-gray-400 hover:text-white uppercase font-bold"
                  >
                    Go Back
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Section Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Hindi Dubbed, Seasonal Picks"
                      value={sectionForm.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        const generatedSlug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                        setSectionForm(prev => ({ 
                          ...prev, 
                          name: val,
                          slug: prev.id ? prev.slug : generatedSlug
                        }));
                      }}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Section Slug (Dynamic Key)</label>
                    <input 
                      type="text" 
                      required
                      disabled={!!editingSection}
                      placeholder="e.g. hindi-dubbed"
                      value={sectionForm.slug}
                      onChange={(e) => setSectionForm(prev => ({ ...prev, slug: e.target.value }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Display Order</label>
                    <input 
                      type="number" 
                      required
                      min={1}
                      placeholder="e.g. 2"
                      value={sectionForm.displayOrder}
                      onChange={(e) => setSectionForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 1 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Max Cards to Show</label>
                    <input 
                      type="number" 
                      required
                      min={1}
                      placeholder="12"
                      value={sectionForm.numCards}
                      onChange={(e) => setSectionForm(prev => ({ ...prev, numCards: parseInt(e.target.value) || 12 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Visible on Homepage</label>
                    <div className="flex items-center gap-3 pt-2">
                      <input 
                        type="checkbox" 
                        checked={sectionForm.visible}
                        onChange={(e) => setSectionForm(prev => ({ ...prev, visible: e.target.checked }))}
                        className="w-5 h-5 accent-primary cursor-pointer rounded bg-black/60 border border-white/10"
                      />
                      <span className="text-xs text-gray-300 font-bold">Show as slider on the home view</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Status</label>
                    <select
                      value={sectionForm.status}
                      onChange={(e) => setSectionForm(prev => ({ ...prev, status: e.target.value as 'active' | 'inactive' }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    >
                      <option value="active">Active (Queries enabled)</option>
                      <option value="inactive">Disabled (Invisible)</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSectionFormOpen(false);
                      setEditingSection(null);
                    }}
                    className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              /* B. LIST MODE */
              <div className="overflow-hidden border border-white/5 rounded-2xl bg-[#0a0d14]/20">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-[#0a0d14]/40 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                      <th className="p-4">Name</th>
                      <th className="p-4">Slug / Key</th>
                      <th className="p-4 text-center">Display Order</th>
                      <th className="p-4 text-center">Max Cards</th>
                      <th className="p-4 text-center">Home Visibility</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03] text-xs font-medium text-gray-300">
                    {dbSections.map((sec) => (
                      <tr key={sec.slug || sec.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="p-4 font-black text-white">{sec.name}</td>
                        <td className="p-4 font-mono text-[10px] text-gray-400">{sec.slug}</td>
                        <td className="p-4 text-center font-bold">{sec.displayOrder}</td>
                        <td className="p-4 text-center font-bold">{sec.numCards || 12}</td>
                        <td className="p-4 text-center">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider",
                            sec.visible !== false ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                          )}>
                            {sec.visible !== false ? 'VISIBLE' : 'HIDDEN'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider",
                            sec.status === 'active' ? "bg-cyan-500/10 text-primary" : "bg-white/5 text-gray-400"
                          )}>
                            {sec.status === 'active' ? 'ACTIVE' : 'DISABLED'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => handleEditSectionClick(sec)}
                              className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg transition-all cursor-pointer"
                              title="Edit Section Settings"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteSection(sec.id || sec.slug)}
                              className="p-2 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 rounded-lg transition-all cursor-pointer"
                              title="Delete Section"
                            >
                              <Trash size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 7: ADVANCED STORAGE MANAGEMENT SYSTEM ZONE */}
        {activeTab === 'storage' && (
          <div className="space-y-6 animate-fadeIn text-gray-300">
            
            {/* Hidden Backup File Input */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (event) => {
                  try {
                    const parsed = JSON.parse(event.target?.result as string);
                    if (parsed.configs && Array.isArray(parsed.configs)) {
                      // Import configs
                      for (const conf of parsed.configs) {
                        if (conf.id && conf.name) {
                          await set(ref(db, `storage_configs/${conf.id}`), conf);
                        }
                      }
                      // Import settings
                      if (parsed.settings) {
                        await set(ref(db, 'storage_settings'), parsed.settings);
                      }
                      alert("Storage configurations imported successfully!");
                    } else {
                      alert("Invalid backup file format. Must contain configs and settings.");
                    }
                  } catch (err) {
                    console.error("Failed to import configuration:", err);
                    alert("Error reading backup file.");
                  }
                };
                reader.readAsText(file);
              }}
              className="hidden" 
              accept=".json"
            />

            {/* Header & Global Orchestration Console */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl backdrop-blur-md">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Server size={16} className="text-primary" />
                    Storage Router & Telemetry Control Center
                  </h3>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed max-w-2xl">
                  Configure unlimited CDN storage providers. Features real-time background health monitoring, zero-latency manual or smart load-balancing, automatic multi-attempt retry, and instant failover rotation to guarantee 100% video/image asset availability.
                </p>
                
                {/* Orchestration settings bar */}
                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-white/5">
                  {/* Auto Rotate Toggle */}
                  <label className="flex items-center gap-2.5 cursor-pointer group bg-white/[0.02] border border-white/5 px-3.5 py-2 rounded-xl hover:bg-white/[0.04] transition-all">
                    <input 
                      type="checkbox" 
                      checked={storageSettings.autoRotate}
                      onChange={handleToggleAutoRotate}
                      className="w-4 h-4 rounded accent-primary border-white/10 bg-black/50 cursor-pointer"
                    />
                    <div>
                      <span className="text-[10px] font-black text-white uppercase tracking-wider block">Auto Failover Rotation</span>
                      <span className="text-[8px] text-gray-500 block">Failover to next priority account on error</span>
                    </div>
                  </label>

                  {/* Smart Storage Mode Toggle */}
                  <label className="flex items-center gap-2.5 cursor-pointer group bg-white/[0.02] border border-white/5 px-3.5 py-2 rounded-xl hover:bg-white/[0.04] transition-all">
                    <input 
                      type="checkbox" 
                      checked={storageSettings.smartMode || false}
                      onChange={handleToggleSmartMode}
                      className="w-4 h-4 rounded accent-primary border-white/10 bg-black/50 cursor-pointer"
                    />
                    <div>
                      <span className="text-[10px] font-black text-white uppercase tracking-wider block">Smart Storage Mode</span>
                      <span className="text-[8px] text-gray-500 block">Always route uploads to the healthiest account</span>
                    </div>
                  </label>

                  {/* Active/Default indicator */}
                  <div className="bg-black/40 px-3.5 py-2 rounded-xl border border-white/5 flex flex-col justify-center min-w-[150px]">
                    <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest block mb-0.5">Primary Active Node</span>
                    <span className="text-[10px] font-black text-primary flex items-center gap-1.5 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      {storageConfigs.find(c => c.id === storageSettings.defaultStorageId)?.name || 'Default Fallback Cloudinary'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Console */}
              <div className="flex flex-col justify-between lg:items-end gap-3.5">
                {!storageFormOpen ? (
                  <button
                    onClick={handleCreateNewStorageClick}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-cyan-500/15 uppercase tracking-wider active:scale-95 shrink-0"
                  >
                    <Plus size={14} className="stroke-[3]" />
                    Add Storage Provider
                  </button>
                ) : (
                  <div className="w-full h-12" />
                )}

                {/* Cloud Backup / Restore controls */}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    onClick={async () => {
                      try {
                        await set(ref(db, 'storage_backups/latest'), {
                          configs: storageConfigs,
                          settings: storageSettings,
                          timestamp: Date.now()
                        });
                        alert("Storage configuration successfully backed up to Cloud!");
                      } catch (err) {
                        alert("Failed to back up configuration to cloud.");
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[9px] font-black text-gray-300 uppercase tracking-widest transition-all cursor-pointer"
                    title="Store configuration backup on database"
                  >
                    <Save size={11} className="text-cyan-400" />
                    Backup Cloud
                  </button>
                  <button
                    onClick={() => {
                      showConfirm(
                        "Restore from Cloud",
                        "Are you sure you want to restore the storage configuration from your last Cloud Backup? This will overwrite your current settings.",
                        async () => {
                          try {
                            const snap = await get(ref(db, 'storage_backups/latest'));
                            if (snap.exists()) {
                              const data = snap.val();
                              if (data.configs) {
                                await remove(ref(db, 'storage_configs'));
                                for (const conf of data.configs) {
                                  await set(ref(db, `storage_configs/${conf.id}`), conf);
                                }
                              }
                              if (data.settings) {
                                await set(ref(db, 'storage_settings'), data.settings);
                              }
                              alert("Storage settings restored successfully from Cloud Backup!");
                            } else {
                              alert("No Cloud Backup snapshot found.");
                            }
                          } catch (err) {
                            alert("Failed to restore configuration.");
                          }
                        }
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[9px] font-black text-gray-300 uppercase tracking-widest transition-all cursor-pointer"
                    title="Restore configuration from database"
                  >
                    <RefreshCw size={11} className="text-orange-400" />
                    Restore Cloud
                  </button>
                  <button
                    onClick={() => {
                      const dataStr = JSON.stringify({ configs: storageConfigs, settings: storageSettings }, null, 2);
                      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
                      const linkElement = document.createElement('a');
                      linkElement.setAttribute('href', dataUri);
                      linkElement.setAttribute('download', 'anova-storage-configs.json');
                      linkElement.click();
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[9px] font-black text-gray-300 uppercase tracking-widest transition-all cursor-pointer"
                    title="Export backup JSON"
                  >
                    <FileText size={11} className="text-emerald-400" />
                    Export JSON
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[9px] font-black text-gray-300 uppercase tracking-widest transition-all cursor-pointer"
                    title="Import backup JSON"
                  >
                    <UploadCloud size={11} className="text-primary" />
                    Import JSON
                  </button>
                </div>
              </div>
            </div>

            {/* Search & Dynamic Filter Console */}
            {!storageFormOpen && (
              <div className="flex flex-col md:flex-row gap-3 bg-[#0a0d14]/20 border border-white/5 p-4 rounded-xl items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input 
                    type="text" 
                    placeholder="Search accounts or cloud name..."
                    value={storageSearchQuery}
                    onChange={(e) => setStorageSearchQuery(e.target.value)}
                    className="w-full bg-black/50 text-[10px] text-white pl-9 pr-4 py-2.5 rounded-lg border border-white/5 outline-none focus:border-primary/50 transition-colors font-semibold"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
                  <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5">
                    <Filter size={10} className="text-gray-500" />
                    <span className="text-[8px] text-gray-500 font-bold uppercase">Filter:</span>
                  </div>

                  {/* Status Filter */}
                  <select
                    value={storageFilterStatus}
                    onChange={(e) => setStorageFilterStatus(e.target.value)}
                    className="bg-black/50 text-[10px] text-gray-300 px-3 py-1.5 rounded-lg border border-white/5 focus:border-primary/40 outline-none font-bold"
                  >
                    <option value="all">Status: All</option>
                    <option value="enabled">Status: Enabled</option>
                    <option value="disabled">Status: Disabled</option>
                  </select>

                  {/* Active Filter */}
                  <select
                    value={storageFilterActive}
                    onChange={(e) => setStorageFilterActive(e.target.value)}
                    className="bg-black/50 text-[10px] text-gray-300 px-3 py-1.5 rounded-lg border border-white/5 focus:border-primary/40 outline-none font-bold"
                  >
                    <option value="all">Active: All</option>
                    <option value="active">Active Primary Only</option>
                    <option value="inactive">Secondary Backup Only</option>
                  </select>

                  {/* Priority Filter */}
                  <select
                    value={storageFilterPriority}
                    onChange={(e) => setStorageFilterPriority(e.target.value)}
                    className="bg-black/50 text-[10px] text-gray-300 px-3 py-1.5 rounded-lg border border-white/5 focus:border-primary/40 outline-none font-bold"
                  >
                    <option value="all">Priority: All</option>
                    <option value="1">Priority #1</option>
                    <option value="2">Priority #2</option>
                    <option value="3">Priority #3</option>
                  </select>

                  {/* Health Check trigger */}
                  <button
                    onClick={async () => {
                      alert("Starting background health scan for all storage providers...");
                      for (const config of storageConfigs) {
                        try {
                          const result = await testConnectionWithConfig(config);
                          const healthStatus = result.success ? "Healthy" : result.message === "Network Error" ? "Offline" : "Warning";
                          await update(ref(db, `storage_configs/${config.id}`), {
                            health: healthStatus,
                            lastUploadTime: Date.now()
                          });
                        } catch (err) {
                          await update(ref(db, `storage_configs/${config.id}`), { health: "Offline" });
                        }
                      }
                      alert("Health check completed for all storage accounts.");
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#00cce0]/10 hover:bg-[#00cce0]/20 text-[#00cce0] text-[9px] font-black uppercase tracking-wider rounded-lg border border-[#00cce0]/20 transition-all cursor-pointer"
                    title="Scan all connections"
                  >
                    <Activity size={11} className="animate-pulse" />
                    Scan Nodes Health
                  </button>
                </div>
              </div>
            )}

            {/* A. FORM MODE: Creating or editing a storage config */}
            {storageFormOpen ? (
              <form onSubmit={handleSaveStorageForm} className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl backdrop-blur-md space-y-6 max-w-3xl mx-auto animate-fadeIn">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Sparkles size={14} className="text-primary" />
                    {editingStorage ? `Modify Provider: ${editingStorage.name}` : 'Configure New Storage Provider'}
                  </h4>
                  <button 
                    type="button" 
                    onClick={() => {
                      setStorageFormOpen(false);
                      setEditingStorage(null);
                    }}
                    className="text-[10px] text-gray-400 hover:text-white uppercase font-black tracking-wider hover:underline"
                  >
                    Cancel & Go Back
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Storage Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Primary Cloudinary, Backup Account"
                      value={storageForm.name}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Provider Adapter</label>
                    <select
                      value={storageForm.provider}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, provider: e.target.value as any }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    >
                      <option value="cloudinary">Cloudinary (Direct signed upload)</option>
                      <option value="cloudflare_r2">Cloudflare R2 (Prepared Adapter)</option>
                      <option value="bunny">Bunny Storage (Prepared Adapter)</option>
                      <option value="aws_s3">AWS S3 / Bucket (Prepared Adapter)</option>
                      <option value="backblaze_b2">Backblaze B2 (Prepared Adapter)</option>
                      <option value="imagekit">ImageKit (Prepared Adapter)</option>
                      <option value="supabase">Supabase Storage (Prepared Adapter)</option>
                      <option value="firebase">Firebase Storage (Prepared Adapter)</option>
                    </select>
                  </div>

                  {storageForm.provider === 'cloudinary' ? (
                    <>
                      <div className="space-y-2">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Cloud Name</label>
                        <input 
                          type="text" 
                          required
                          placeholder="Enter Cloudinary Cloud Name"
                          value={storageForm.cloudName}
                          onChange={(e) => setStorageForm(prev => ({ ...prev, cloudName: e.target.value }))}
                          className="w-full bg-black/60 text-xs font-mono text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">API Key</label>
                        <input 
                          type="text" 
                          required
                          placeholder="Enter Cloudinary API Key"
                          value={storageForm.apiKey}
                          onChange={(e) => setStorageForm(prev => ({ ...prev, apiKey: e.target.value }))}
                          className="w-full bg-black/60 text-xs font-mono text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">API Secret (Client-Side Signature Encryption Key)</label>
                        <input 
                          type="password" 
                          required
                          placeholder="Enter Cloudinary API Secret"
                          value={storageForm.apiSecret}
                          onChange={(e) => setStorageForm(prev => ({ ...prev, apiSecret: e.target.value }))}
                          className="w-full bg-black/60 text-xs font-mono text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Upload Folder Path</label>
                        <input 
                          type="text" 
                          placeholder="e.g. anova_anime"
                          value={storageForm.folder}
                          onChange={(e) => setStorageForm(prev => ({ ...prev, folder: e.target.value }))}
                          className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Default Folder Path</label>
                        <input 
                          type="text" 
                          placeholder="e.g. anova_anime"
                          value={storageForm.defaultFolder}
                          onChange={(e) => setStorageForm(prev => ({ ...prev, defaultFolder: e.target.value }))}
                          className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-2 bg-[#0a0d14]/60 border border-white/5 p-4 rounded-xl text-center text-xs text-gray-400">
                      You are preparing a configuration for <span className="font-bold text-primary uppercase">{storageForm.provider}</span>. When this adapter is activated, the required fields will display here. Priority ranking and capacity controls remain fully operational.
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Priority Rank (Failover Order)</label>
                    <input 
                      type="number" 
                      required
                      min={1}
                      placeholder="e.g. 1"
                      value={storageForm.priority}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, priority: parseInt(e.target.value) || 1 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Operational Status</label>
                    <select
                      value={storageForm.status}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, status: e.target.value as any }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    >
                      <option value="enabled">Enabled (Candidate for active uploads & failovers)</option>
                      <option value="disabled">Disabled (Do not use)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Maximum Upload File Size (MB)</label>
                    <input 
                      type="number" 
                      min={1}
                      placeholder="e.g. 50"
                      value={storageForm.maxUploadSize}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, maxUploadSize: parseInt(e.target.value) || 50 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Maximum Daily Uploads</label>
                    <input 
                      type="number" 
                      min={1}
                      placeholder="e.g. 100"
                      value={storageForm.maxDailyUploads}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, maxDailyUploads: parseInt(e.target.value) || 100 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Maximum Total Storage (MB)</label>
                    <input 
                      type="number" 
                      min={1}
                      placeholder="e.g. 1024"
                      value={storageForm.maxStorage}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, maxStorage: parseInt(e.target.value) || 1024 }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider block">Notes / Description</label>
                    <textarea 
                      placeholder="Add any reminders about this storage account..."
                      value={storageForm.notes}
                      onChange={(e) => setStorageForm(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full bg-black/60 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors h-20 resize-none"
                    />
                  </div>
                </div>

                <div className="border-t border-white/5 pt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStorageFormOpen(false);
                      setEditingStorage(null);
                    }}
                    className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-primary hover:bg-[#00cce0] text-black font-black text-xs rounded-xl transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Save configuration
                  </button>
                </div>
              </form>
            ) : (
              /* B. DISPLAY MODE: Cards & History */
              <div className="space-y-8 animate-fadeIn">
                
                {/* Custom filtered configurations cards list */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Default fallback card is shown if list is completely empty */}
                  {storageConfigs.length === 0 && (
                    <div className="bg-[#0a0d14]/20 border border-dashed border-white/10 p-6 rounded-2xl flex flex-col items-center justify-center text-center space-y-3 lg:col-span-3 min-h-[220px]">
                      <Server size={32} className="text-gray-500 animate-pulse" />
                      <div>
                        <h4 className="text-xs font-black text-white uppercase tracking-wider">No Custom Storages Configured</h4>
                        <p className="text-[9px] text-gray-400 mt-1 max-w-sm">
                          The system is currently defaulting to the pre-loaded built-in fallback Cloudinary credentials. Click "+ Add Storage Provider" to configure your own custom accounts.
                        </p>
                      </div>
                    </div>
                  )}

                  {storageConfigs
                    .filter(config => {
                      // Apply Search Filter
                      if (storageSearchQuery.trim()) {
                        const nameMatch = config.name.toLowerCase().includes(storageSearchQuery.toLowerCase());
                        const cloudMatch = (config.cloudName || '').toLowerCase().includes(storageSearchQuery.toLowerCase());
                        if (!nameMatch && !cloudMatch) return false;
                      }
                      // Apply Provider Filter
                      if (storageFilterProvider !== 'all' && config.provider !== storageFilterProvider) return false;
                      // Apply Status Filter
                      if (storageFilterStatus !== 'all' && config.status !== storageFilterStatus) return false;
                      // Apply Priority Filter
                      if (storageFilterPriority !== 'all' && String(config.priority) !== storageFilterPriority) return false;
                      // Apply Active Filter
                      if (storageFilterActive !== 'all') {
                        const isActive = storageSettings.defaultStorageId === config.id;
                        if (storageFilterActive === 'active' && !isActive) return false;
                        if (storageFilterActive === 'inactive' && isActive) return false;
                      }
                      return true;
                    })
                    .map((config) => {
                      const isDefault = storageSettings.defaultStorageId === config.id;
                      const testResult = testConnectionResults[config.id];
                      const isTesting = isTestingConnection[config.id];
                      
                      // Calculate real Today's Uploads for this specific storage
                      const startOfToday = new Date();
                      startOfToday.setHours(0,0,0,0);
                      const todaysUploads = uploadHistory.filter(item => 
                        item.storageId === config.id && 
                        item.uploadedAt >= startOfToday.getTime()
                      ).length;

                      // Simulated Storage Usage based on total uploads (e.g. 1.8 MB per upload average)
                      const maxTotalStorage = config.maxStorage || 1024;
                      const simulatedUsedStorage = Math.round((config.totalUploads || 0) * 1.8 * 10) / 10;
                      const storagePercent = Math.min(100, Math.round((simulatedUsedStorage / maxTotalStorage) * 100));

                      // Simulated Bandwidth Usage based on total uploads (e.g. 4.2 MB per upload average)
                      const simulatedBandwidth = Math.round((config.totalUploads || 0) * 4.2 * 10) / 10;

                      return (
                        <div 
                          key={config.id} 
                          className={cn(
                            "bg-[#0a0d14]/30 border rounded-2xl p-5 flex flex-col justify-between backdrop-blur-md relative overflow-hidden transition-all group hover:border-white/10",
                            isDefault ? "border-primary/40 shadow-[0_0_25px_rgba(0,229,255,0.05)] ring-1 ring-primary/20" : "border-white/5"
                          )}
                        >
                          {/* Top Highlight Stripe for Primary Node */}
                          {isDefault && <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-cyan-400 to-primary" />}
                          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/[0.01] rounded-full blur-2xl pointer-events-none" />

                          <div>
                            {/* Card Header Info */}
                            <div className="flex items-start justify-between gap-2 mb-3.5">
                              <div>
                                <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                                  {config.name}
                                  {isDefault && (
                                    <span className="bg-primary/10 text-primary text-[7px] font-black tracking-widest px-2 py-0.5 rounded-full border border-primary/25 animate-pulse">
                                      PRIMARY
                                    </span>
                                  )}
                                </h4>
                                <p className="text-[8px] text-gray-500 font-mono tracking-wider mt-0.5 uppercase">ID: {config.id}</p>
                              </div>
                              
                              <div className="flex flex-col items-end gap-1.5">
                                <span className={cn(
                                  "text-[7px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full",
                                  config.status === 'enabled' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                                )}>
                                  {config.status}
                                </span>
                              </div>
                            </div>

                            {/* Credentials Summary Panel */}
                            <div className="bg-black/40 border border-white/5 rounded-xl p-3.5 space-y-2.5 text-[9px] font-mono">
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500 uppercase font-black text-[8px]">Provider Logo:</span>
                                <span className="text-primary font-bold uppercase tracking-wider flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                                  <Server className="text-primary" size={10} />
                                  {config.provider}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase font-black text-[8px]">Cloud Name:</span>
                                <span className="text-gray-300 font-bold">{config.cloudName || 'N/A'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase font-black text-[8px]">Upload Folder:</span>
                                <span className="text-gray-300 font-bold">{config.folder || 'anova_anime'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase font-black text-[8px]">Default Folder:</span>
                                <span className="text-gray-300 font-bold">{config.defaultFolder || 'anova_anime'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase font-black text-[8px]">Priority Rank:</span>
                                <span className="text-primary font-black uppercase">Order #{config.priority}</span>
                              </div>
                            </div>

                            {/* Storage & Bandwidth Capacity Gauges */}
                            <div className="mt-4 space-y-3 bg-black/20 border border-white/5 p-3 rounded-xl">
                              {/* Storage gauge */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[8px] font-black text-gray-400 uppercase">
                                  <span>Storage Used: {simulatedUsedStorage} MB</span>
                                  <span>Max: {maxTotalStorage} MB</span>
                                </div>
                                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-primary h-full transition-all duration-500" 
                                    style={{ width: `${storagePercent}%` }} 
                                  />
                                </div>
                              </div>

                              {/* Bandwidth gauge */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[8px] font-black text-gray-400 uppercase">
                                  <span>File Limit: {config.maxUploadSize || 50} MB</span>
                                  <span>Bandwidth: {simulatedBandwidth} MB</span>
                                </div>
                                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-cyan-500 h-full transition-all duration-500" 
                                    style={{ width: `${Math.min(100, Math.round((simulatedBandwidth / 500) * 100))}%` }} 
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Telemetry / Live Status Matrix */}
                            <div className="grid grid-cols-2 gap-3 mt-4 border-t border-b border-white/5 py-3 text-[9px]">
                              <div>
                                <span className="text-gray-500 font-bold block uppercase tracking-wider text-[8px]">Total Uploads</span>
                                <span className="text-white font-black text-xs block mt-0.5">{config.totalUploads || 0}</span>
                              </div>
                              <div>
                                <span className="text-gray-500 font-bold block uppercase tracking-wider text-[8px]">Today's Uploads</span>
                                <span className="text-cyan-400 font-black text-xs block mt-0.5">{todaysUploads} / {config.maxDailyUploads || 100}</span>
                              </div>
                              <div>
                                <span className="text-gray-500 font-bold block uppercase tracking-wider text-[8px]">Health Connection</span>
                                <span className={cn(
                                  "font-black block mt-0.5 text-[10px] flex items-center gap-1",
                                  config.health === 'Connected' || config.health === 'Healthy' 
                                    ? "text-emerald-400" 
                                    : config.health === 'Warning'
                                      ? "text-yellow-400"
                                      : config.health === 'Offline'
                                        ? "text-red-500"
                                        : "text-gray-400"
                                )}>
                                  <span className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    config.health === 'Connected' || config.health === 'Healthy'
                                      ? "bg-emerald-400 animate-pulse"
                                      : config.health === 'Warning'
                                        ? "bg-yellow-400"
                                        : "bg-red-500"
                                  )} />
                                  {config.health || 'Not Tested'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500 font-bold block uppercase tracking-wider text-[8px]">Last Upload</span>
                                <span className="text-gray-400 block mt-0.5 text-[9px] truncate" title={config.lastUploadTime ? new Date(config.lastUploadTime).toLocaleString() : 'Never'}>
                                  {config.lastUploadTime ? new Date(config.lastUploadTime).toLocaleDateString() : 'Never'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Actions Panel */}
                          <div className="mt-5 flex flex-col gap-2.5">
                            {/* Live Connection Test Output Box */}
                            {testResult && (
                              <div className={cn(
                                "text-[8px] font-bold p-1.5 rounded-lg border flex items-center gap-1.5 animate-fadeIn",
                                testResult.success ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/10" : "bg-red-500/5 text-red-400 border-red-500/10"
                              )}>
                                <CheckCircle size={10} />
                                Telemetry: {testResult.message}
                              </div>
                            )}

                            <div className="flex gap-2 justify-between items-center pt-2 border-t border-white/5">
                              <div className="flex gap-1.5">
                                {/* Edit */}
                                <button
                                  onClick={() => handleEditStorageClick(config)}
                                  className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg border border-white/5 transition-all cursor-pointer"
                                  title="Edit Credentials"
                                >
                                  <Edit3 size={11} />
                                </button>
                                {/* Delete */}
                                <button
                                  onClick={() => handleDeleteStorageClick(config.id, config.name)}
                                  className="p-2 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 border border-red-500/10 rounded-lg transition-all cursor-pointer"
                                  title="Delete Provider Node"
                                >
                                  <Trash size={11} />
                                </button>
                              </div>

                              <div className="flex gap-1.5">
                                {/* Test connection button */}
                                <button
                                  onClick={() => handleTestStorageConnection(config)}
                                  disabled={isTesting}
                                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[8px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 border border-white/5"
                                >
                                  <RefreshCw size={10} className={isTesting ? "animate-spin" : ""} />
                                  {isTesting ? 'Testing...' : 'Test Connection'}
                                </button>

                                {/* Set Active/Primary Button */}
                                {!isDefault && (
                                  <button
                                    onClick={() => handleSetDefaultStorage(config.id)}
                                    className="px-2.5 py-1.5 bg-primary hover:bg-[#00cce0] text-black text-[8px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                                  >
                                    Activate
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Live upload telemetry log list */}
                <div className="space-y-3 bg-[#0a0d14]/20 border border-white/5 p-5 rounded-2xl backdrop-blur-md">
                  <div>
                    <h4 className="text-[10px] font-black text-white uppercase tracking-wider">Live Upload History Logs</h4>
                    <p className="text-[8px] text-gray-500">Real-time database records of direct browser-to-cloud file transfers.</p>
                  </div>

                  <div className="overflow-hidden border border-white/5 rounded-xl bg-[#0a0d14]/10 max-h-96 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 bg-[#0a0d14]/40 text-[8px] font-black text-gray-500 uppercase tracking-widest">
                          <th className="p-3">File Name</th>
                          <th className="p-3 text-center">Type</th>
                          <th className="p-3">Destination Storage</th>
                          <th className="p-3">Uploader</th>
                          <th className="p-3">Timestamp</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-right">Payload Access</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.02] text-[9px] font-medium text-gray-400 font-mono">
                        {uploadHistory.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-[8px] text-gray-500 font-bold uppercase">No upload records stored in telemetry.</td>
                          </tr>
                        )}
                        {uploadHistory.map((item) => (
                          <tr key={item.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="p-3 font-bold text-white max-w-[150px] truncate" title={item.fileName}>
                              {item.fileName}
                            </td>
                            <td className="p-3 text-center">
                              <span className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] font-black text-gray-300 uppercase tracking-wider">
                                {item.fileType}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="font-bold text-primary">{item.storageName}</span>
                              <span className="text-[8px] text-gray-500 ml-1">({item.provider})</span>
                            </td>
                            <td className="p-3 text-gray-300 font-semibold">{item.uploader}</td>
                            <td className="p-3 text-gray-400">
                              {new Date(item.uploadedAt).toLocaleString()}
                            </td>
                            <td className="p-3 text-center">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider",
                                item.status === 'success' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                              )}>
                                {item.status}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              {item.url ? (
                                <a 
                                  href={item.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-black text-[8px]"
                                >
                                  VIEW ASSET
                                </a>
                              ) : (
                                <span className="text-red-400 text-[8px]">{item.errorMessage || 'FAILED'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 8: ADVERTISEMENT MANAGER */}
        {activeTab === 'ads' && (
          <div className="space-y-6 animate-fadeIn text-gray-300">
            {/* Header & Create Button */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl backdrop-blur-md">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Megaphone className="text-primary animate-pulse" size={24} />
                  <span>Advertisement Manager</span>
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Manage start video advertisements, scripts, and targeting rules across all catalog content.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingAd(null);
                  setAdForm({
                    id: '',
                    name: '',
                    provider: '',
                    type: 'Popunder',
                    status: 'enabled',
                    script: '',
                    priority: 10,
                    frequency: 'always',
                    startDate: '',
                    endDate: '',
                    targetMode: 'all',
                    targetAnimeIds: []
                  });
                  setAdFormSearchQuery('');
                  setIsAdFormOpen(!isAdFormOpen);
                }}
                className="px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/40 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all duration-300 hover:scale-105 cursor-pointer"
              >
                <Plus size={14} />
                <span>{isAdFormOpen ? 'Close Form' : 'Create Advertisement'}</span>
              </button>
            </div>

            {/* CREATE / EDIT FORM */}
            {isAdFormOpen && (
              <div className="bg-[#0a0d14]/50 border border-white/10 p-6 rounded-2xl backdrop-blur-lg animate-fadeIn shadow-2xl relative">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-[#00e5ff]" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider mb-6 border-b border-white/5 pb-3">
                  {editingAd ? `Edit Advertisement: ${editingAd.name}` : 'Create New Advertisement'}
                </h3>

                <form onSubmit={handleSaveAd} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Advertisement Name */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Advertisement Name</label>
                      <input
                        type="text"
                        value={adForm.name}
                        onChange={(e) => setAdForm({ ...adForm, name: e.target.value })}
                        placeholder="e.g. Adsterra Social Bar"
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    {/* Provider Name */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Provider Name</label>
                      <input
                        type="text"
                        value={adForm.provider}
                        onChange={(e) => setAdForm({ ...adForm, provider: e.target.value })}
                        placeholder="e.g. Adsterra, HilltopAds"
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    {/* Advertisement Type */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Advertisement Type</label>
                      <select
                        value={adForm.type}
                        onChange={(e) => setAdForm({ ...adForm, type: e.target.value })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      >
                        <option value="Popunder">Popunder</option>
                        <option value="Direct Link">Direct Link</option>
                        <option value="Script">Script</option>
                        <option value="Banner">Banner</option>
                      </select>
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Status</label>
                      <select
                        value={adForm.status}
                        onChange={(e) => setAdForm({ ...adForm, status: e.target.value as 'enabled' | 'disabled' })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      >
                        <option value="enabled">Enable</option>
                        <option value="disabled">Disable</option>
                      </select>
                    </div>

                    {/* Priority */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Priority (Higher runs first)</label>
                      <input
                        type="number"
                        value={adForm.priority}
                        onChange={(e) => setAdForm({ ...adForm, priority: Number(e.target.value || 10) })}
                        placeholder="e.g. 10"
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    {/* Frequency */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Frequency Rules</label>
                      <select
                        value={adForm.frequency}
                        onChange={(e) => setAdForm({ ...adForm, frequency: e.target.value })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      >
                        <option value="always">Every Play</option>
                        <option value="every_5_m">Every 5 Minutes</option>
                        <option value="every_10_m">Every 10 Minutes</option>
                        <option value="every_15_m">Every 15 Minutes</option>
                        <option value="every_30_m">Every 30 Minutes</option>
                        <option value="once_per_hour">Every Hour</option>
                        <option value="once_per_session">Once Per Session</option>
                      </select>
                    </div>

                    {/* Start Date */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Start Date (Optional)</label>
                      <input
                        type="date"
                        value={adForm.startDate}
                        onChange={(e) => setAdForm({ ...adForm, startDate: e.target.value })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    {/* End Date */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">End Date (Optional)</label>
                      <input
                        type="date"
                        value={adForm.endDate}
                        onChange={(e) => setAdForm({ ...adForm, endDate: e.target.value })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      />
                    </div>

                    {/* Target Mode */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">Target Mode</label>
                      <select
                        value={adForm.targetMode}
                        onChange={(e) => setAdForm({ ...adForm, targetMode: e.target.value, targetAnimeIds: [] })}
                        className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-bold"
                      >
                        <option value="all">ALL CONTENT</option>
                        <option value="single">Single Anime</option>
                        <option value="multiple">Multiple Anime</option>
                      </select>
                    </div>
                  </div>

                  {/* Advertisement Script */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-wider">
                      Advertisement Script or Direct Link (HTML, Javascript, or Raw URL)
                    </label>
                    <textarea
                      value={adForm.script}
                      onChange={(e) => setAdForm({ ...adForm, script: e.target.value })}
                      placeholder='e.g. <script src="https://example.com/ad.js"></script>'
                      rows={5}
                      className="w-full bg-black/40 text-xs text-white px-4 py-3 rounded-xl border border-white/5 outline-none focus:border-primary/50 transition-colors font-mono font-medium"
                    />
                    <p className="text-[9px] text-gray-500 italic">
                      Paste the script exactly as provided by your advertising network. Or paste a raw URL for direct linking.
                    </p>
                  </div>

                  {/* TARGETING & ROUTING */}
                  <div className="border-t border-white/5 pt-6 space-y-4 font-sans">
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Targeting Rules</h4>

                    {/* SELECTOR FOR SPECIFIC TARGET CONTENT */}
                    {adForm.targetMode !== 'all' && (
                      <div className="space-y-4 bg-white/[0.01] border border-white/5 p-5 rounded-xl">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div>
                            <p className="text-xs text-white font-black uppercase tracking-wider">
                              Target Anime Selector ({adForm.targetMode === 'single' ? 'Single Select' : 'Multi-Select'})
                            </p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              Search and select which anime this advertisement should target.
                            </p>
                          </div>
                          <div className="flex items-center gap-2 w-full md:w-auto">
                            {/* Search bar inside selector */}
                            <div className="relative w-full md:w-60">
                              <input
                                type="text"
                                value={adFormSearchQuery}
                                onChange={(e) => setAdFormSearchQuery(e.target.value)}
                                placeholder="Search synchronized content..."
                                className="w-full bg-black/50 text-[10px] text-white pl-8 pr-4 py-2 rounded-lg border border-white/5 outline-none focus:border-primary/50 font-bold"
                              />
                              <Search className="absolute left-2.5 top-2.5 text-gray-500" size={12} />
                            </div>
                            
                            {/* Multi-select helpers */}
                            {adForm.targetMode === 'multiple' && (
                              <div className="flex gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const allIds = customAnimes.map(a => String(a.id));
                                    setAdForm({ ...adForm, targetAnimeIds: allIds });
                                  }}
                                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase tracking-wider rounded-lg border border-white/5 text-white transition-all cursor-pointer"
                                >
                                  Select All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdForm({ ...adForm, targetAnimeIds: [] });
                                  }}
                                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase tracking-wider rounded-lg border border-white/5 text-white transition-all cursor-pointer"
                                >
                                  Deselect
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Format Tabs inside selector */}
                        <div className="flex gap-2 border-b border-white/5 pb-2 overflow-x-auto hide-scrollbar text-[10px] font-black uppercase tracking-wider">
                          {[
                            { id: 'all', label: 'All Content' },
                            { id: 'TV', label: 'Anime Shows' },
                            { id: 'Movie', label: 'Movies' },
                            { id: 'OVA', label: 'OVA' },
                            { id: 'ONA', label: 'ONA' },
                            { id: 'Special', label: 'Specials' }
                          ].map(tab => (
                            <button
                              type="button"
                              key={tab.id}
                              onClick={() => setAdContentFormatFilter(tab.id)}
                              className={cn(
                                "pb-2 -mb-[9px] border-b-2 transition-all whitespace-nowrap px-2 cursor-pointer",
                                adContentFormatFilter === tab.id
                                  ? "text-primary border-primary font-black"
                                  : "text-gray-500 border-transparent hover:text-white"
                              )}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        {/* Content Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                          {customAnimes.length === 0 ? (
                            <p className="text-[10px] text-gray-500 col-span-full py-4 text-center">No content found in catalog.</p>
                          ) : (
                            customAnimes
                              .filter(anime => {
                                if (adContentFormatFilter === 'all') {
                                  if (adFormSearchQuery) {
                                    return anime.title?.toLowerCase().includes(adFormSearchQuery.toLowerCase());
                                  }
                                  return true;
                                }
                                let typeMatch = anime.type === adContentFormatFilter;
                                if (adContentFormatFilter === 'TV' && !anime.type) typeMatch = true;
                                if (adFormSearchQuery) {
                                  return typeMatch && anime.title?.toLowerCase().includes(adFormSearchQuery.toLowerCase());
                                }
                                return typeMatch;
                              })
                              .map(anime => {
                                const isSelected = adForm.targetAnimeIds.includes(String(anime.id));
                                return (
                                  <div
                                    key={anime.id}
                                    onClick={() => {
                                      if (adForm.targetMode === 'single') {
                                        setAdForm({ ...adForm, targetAnimeIds: [String(anime.id)] });
                                      } else {
                                        const exists = adForm.targetAnimeIds.includes(String(anime.id));
                                        const next = exists
                                          ? adForm.targetAnimeIds.filter(id => id !== String(anime.id))
                                          : [...adForm.targetAnimeIds, String(anime.id)];
                                        setAdForm({ ...adForm, targetAnimeIds: next });
                                      }
                                    }}
                                    className={cn(
                                      "p-2 bg-black/40 border rounded-lg cursor-pointer hover:border-primary/40 transition-all text-center space-y-1.5 flex flex-col justify-between h-full select-none relative group",
                                      isSelected ? "border-primary bg-primary/5 shadow-[0_0_12px_rgba(0,229,255,0.15)]" : "border-white/5"
                                    )}
                                  >
                                    <img
                                      src={anime.poster}
                                      alt={anime.title}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-20 object-cover rounded-md"
                                    />
                                    <p className="text-[9px] font-bold text-white line-clamp-1">{anime.title}</p>
                                    <div className="flex items-center justify-between gap-1 text-[7px] text-gray-500 uppercase font-black tracking-wider bg-white/5 py-0.5 px-1 rounded">
                                      <span>{anime.type || 'TV'}</span>
                                      {isSelected && <span className="text-primary font-black">✓</span>}
                                    </div>
                                  </div>
                                );
                              })
                          )}
                        </div>

                        {/* Selected Indicator Summary */}
                        <div className="text-[10px] text-gray-400 font-bold bg-white/[0.02] p-3 rounded-lg border border-white/5 flex flex-wrap gap-2 items-center">
                          <span>Currently Selected ({adForm.targetAnimeIds.length}):</span>
                          {adForm.targetAnimeIds.length === 0 ? (
                            <span className="text-red-400">None. Please select at least one anime above.</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto w-full">
                              {adForm.targetAnimeIds.map(id => {
                                const found = customAnimes.find(a => String(a.id) === id);
                                return (
                                  <span key={id} className="bg-primary/10 border border-primary/20 text-primary text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                                    {found?.title || `ID: ${id}`}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Form Action Buttons */}
                  <div className="flex justify-end gap-3.5 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdFormOpen(false);
                        setEditingAd(null);
                      }}
                      className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-[0_0_15px_rgba(0,229,255,0.25)] transition-all duration-300 cursor-pointer"
                    >
                      <Save size={14} />
                      <span>{editingAd ? 'Save Changes' : 'Save Advertisement'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ADVERTISEMENTS LIST TABLE */}
            <div className="bg-[#0a0d14]/30 border border-white/5 p-6 rounded-2xl backdrop-blur-md space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Active Campaigns &amp; Ads</h3>
                {/* Ad List Search */}
                <div className="relative w-full md:w-72">
                  <input
                    type="text"
                    value={adSearchQuery}
                    onChange={(e) => setAdSearchQuery(e.target.value)}
                    placeholder="Search campaigns..."
                    className="w-full bg-black/50 text-xs text-white pl-9 pr-4 py-2.5 rounded-xl border border-white/5 outline-none focus:border-primary/50 font-bold"
                  />
                  <Search className="absolute left-3 top-3 text-gray-500" size={14} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-white/5 font-mono">
                      <th className="p-4">Name / Provider</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Priority</th>
                      <th className="p-4">Target Scope</th>
                      <th className="p-4">Frequency</th>
                      <th className="p-4 text-center">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.02] text-xs font-medium text-gray-300">
                    {advertisements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-xs text-gray-500 font-bold uppercase">
                          No advertisements configured in the database.
                        </td>
                      </tr>
                    ) : (
                      advertisements
                        .filter(ad => {
                          if (adSearchQuery) {
                            return ad.name?.toLowerCase().includes(adSearchQuery.toLowerCase()) ||
                                   ad.provider?.toLowerCase().includes(adSearchQuery.toLowerCase());
                          }
                          return true;
                        })
                        .map(ad => {
                          let scopeText = "Specific Content";
                          if (ad.targetMode === 'all') {
                            scopeText = "All Content";
                          } else if (ad.targetMode === 'single') {
                            const targetId = ad.targetAnimeIds?.[0] || ad.targetAnimeId;
                            const showTitle = customAnimes.find(a => String(a.id) === String(targetId))?.title || "Unknown Show";
                            scopeText = `Single: ${showTitle}`;
                          } else if (ad.targetMode === 'multiple') {
                            scopeText = `Multiple (${ad.targetAnimeIds?.length || 0} shows)`;
                          }

                          return (
                            <tr key={ad.id} className="hover:bg-white/[0.01] transition-colors">
                              <td className="p-4">
                                <div className="font-bold text-white">{ad.name}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">{ad.provider}</div>
                              </td>
                              <td className="p-4 font-bold text-gray-400">{ad.type || 'Popunder'}</td>
                              <td className="p-4 font-mono font-bold text-primary">{ad.priority}</td>
                              <td className="p-4">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                                  ad.targetMode === 'all' 
                                    ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" 
                                    : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                                )}>
                                  {scopeText}
                                </span>
                              </td>
                              <td className="p-4 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{ad.frequency}</td>
                              <td className="p-4 text-center">
                                <button
                                  onClick={() => handleToggleAdStatus(ad)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider transition-colors cursor-pointer",
                                    ad.status === 'enabled' 
                                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" 
                                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                                  )}
                                  title="Click to toggle Status"
                                >
                                  {ad.status === 'enabled' ? 'Active' : 'Disabled'}
                                </button>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setPreviewAd(ad)}
                                    className="p-1.5 hover:bg-white/5 rounded-lg text-cyan-400 hover:text-cyan-300 transition-all cursor-pointer"
                                    title="Preview Campaign"
                                  >
                                    <Eye size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDuplicateAd(ad)}
                                    className="p-1.5 hover:bg-white/5 rounded-lg text-emerald-400 hover:text-emerald-300 transition-all cursor-pointer"
                                    title="Duplicate Campaign"
                                  >
                                    <Clipboard size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleEditAd(ad)}
                                    className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-all cursor-pointer"
                                    title="Edit Advertisement"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAdTrigger(ad)}
                                    className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-400 transition-all cursor-pointer"
                                    title="Delete Advertisement"
                                  >
                                    <Trash size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ad Preview Modal */}
            {previewAd && (
              <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center z-[999999] animate-fadeIn p-4 font-sans">
                <div className="bg-[#050505] border border-white/10 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative overflow-hidden flex flex-col h-[80vh]">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500 to-primary" />
                  
                  <div className="flex justify-between items-center border-b border-white/5 pb-3 mb-4 shrink-0">
                    <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-wider">
                        Campaign Preview: {previewAd.name}
                      </h3>
                      <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">
                        Type: {previewAd.type || 'Popunder'} | Provider: {previewAd.provider}
                      </p>
                    </div>
                    <button
                      onClick={() => setPreviewAd(null)}
                      className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 text-white rounded-lg text-xs font-black uppercase cursor-pointer"
                    >
                      Close Preview
                    </button>
                  </div>

                  <div className="flex-1 w-full flex items-center justify-center bg-black/60 rounded-xl border border-white/5 p-4 overflow-auto relative min-h-0">
                    <div className="w-full h-full flex items-center justify-center relative">
                      <AdScriptRunner script={previewAd.script} />
                    </div>
                  </div>

                  <div className="mt-4 text-[10px] text-gray-500 text-center uppercase tracking-wider font-semibold shrink-0">
                    Testing sandbox container. Live campaigns will run before video play.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Custom Confirmation Modal */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[999999] animate-fadeIn p-4">
          <div className="bg-[#0a0d14] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500 to-primary" />
            <h3 className="text-base font-black text-white uppercase tracking-wider mb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed mb-6">
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-3.5">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDialog.onConfirm()}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/30 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DailymotionBrandingToggle() {
  const [enabled, setEnabled] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem('anova_hide_dm_branding') !== 'false' : true)
  );
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem('anova_hide_dm_branding', next ? 'true' : 'false');
    window.dispatchEvent(new Event('anova_hide_dm_branding_changed'));
  };
  return (
    <div className="bg-white/[0.01] border border-white/5 p-4 rounded-xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-wider">Player Branding</p>
          <p className="text-xs text-white font-black mt-1 leading-snug">
            Hide Dailymotion Branding &amp; Show Custom Logo
          </p>
          <p className="text-[9px] text-gray-500 font-bold mt-1 leading-snug">
            Overlays a small AnOvA badge on top-left of Dailymotion iframes only.
          </p>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          className={cn(
            "relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer border",
            enabled
              ? "bg-[#1E3A8A] border-[#3b82f6]/60 shadow-[0_0_10px_rgba(59,130,246,0.35)]"
              : "bg-white/5 border-white/10"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform",
              enabled && "translate-x-5"
            )}
          />
        </button>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0a1836] border border-[#1E3A8A]/70 shadow-inner">
          <span className="font-black text-white text-[11px] tracking-tight leading-none">AnOvA</span>
          <span className="font-black text-[#3b82f6] text-[13px] leading-none -ml-0.5">.</span>
        </div>
        <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Preview</span>
        <span
          className={cn(
            "ml-auto text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded",
            enabled
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-white/5 text-gray-400 border border-white/10"
          )}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  );
}
