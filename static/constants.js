// دریافت عناصر DOM
var apiUrlInput = document.getElementById('api-key-input');
var saveApiUrlBtn = document.getElementById('save-api-key-btn');
var projectNameInput = document.getElementById('project-name-input');
var batchSizeInput = document.getElementById('batch-size-input');
var autoAdvanceTimeInput = document.getElementById('auto-advance-time-input');
var genreSelect = document.getElementById('genre-select'); 
var batchInfoText = document.getElementById('batch-info-text');
var batchRangeDisplay = document.getElementById('batch-range-display');
var imageUpload = document.getElementById('image-upload');
var imageContainer = document.getElementById('image-container');
var imageContainerWrapper = document.getElementById('image-container-wrapper');
var leftSidebar = document.getElementById('left-sidebar');
var rightSidebar = document.getElementById('right-sidebar');
var outputList = document.getElementById('output-list');
var toolBtns = document.querySelectorAll('.tool-btn');
var sendBatchBtn = document.getElementById('send-batch-btn');
var confirmNextBtn = document.getElementById('confirm-next-btn');
var retryEmptyBtn = document.getElementById('retry-empty-btn');
var retryDeletedBtn = document.getElementById('retry-deleted-btn');
var clearAllTextBtn = document.getElementById('clear-all-text-btn');
var clearAllMarkingsBtn = document.getElementById('clear-all-markings');
var clearAllOutputsBtn = document.getElementById('clear-all-outputs-btn');
var exportTxtBtn = document.getElementById('export-txt');
var exportHtmlBtn = document.getElementById('export-html');
var exportZipBtn = document.getElementById('export-zip-btn');
var errorContainer = document.getElementById('error-container');
var errorMessage = document.getElementById('error-message');
var closeErrorBtn = document.getElementById('close-error-btn');
var imageList = document.getElementById('image-list');
var zoomInBtn = document.getElementById('zoom-in');
var zoomOutBtn = document.getElementById('zoom-out');

// عناصر مربوط به مدیریت پروژه
var saveProjectBtn = document.getElementById('save-project-btn');
var loadJsonBtn = document.getElementById('load-json-btn');
var loadJsonInput = document.getElementById('load-json-input');

// عناصر مربوط به وارد کردن ترجمه
var openImportModalBtn = document.getElementById('open-import-modal-btn');
var importModal = document.getElementById('import-modal');
var importTextarea = document.getElementById('import-textarea');
var processImportBtn = document.getElementById('process-import-btn');
var closeImportBtn = document.getElementById('close-import-btn');

// عناصر جدید مدیریت فونت
var fontInputs = Array.from(document.querySelectorAll('.font-input'));
var clearFontBtns = Array.from(document.querySelectorAll('.clear-font-btn'));
var fontNameDisplays = Array.from(document.querySelectorAll('[id^="font-name-"]'));

// دکمه جابجایی بین متن اصلی و ترجمه
var toggleOriginalBtn = document.getElementById('toggle-original-btn');

// المان‌های جدید برای Magic Wand و چرخش
var magicWandLoading = document.getElementById('magic-wand-loading');
var rotationHint = document.getElementById('rotation-hint');
var rotationProgress = document.querySelector('.timer-progress');

// متغیرهای وضعیت برنامه
var batchSize = 10;
var lmStudioUrl = '';
var images = [];
var markings = [];
var currentTool = 'rect';
var isDrawing = false;
var startX, startY;
var currentPolygonPoints = [];
var nextMarkingId = 1;
var activeImageIndex = -1;
var viewPosX = 0, viewPosY = 0;
var isPanning = false;
var panStartX, panStartY;
var zoomLevel = 1;
var lastProcessedMarkingIndex = -1;
var currentBatchMarkings = [];
var isAwaitingConfirmation = false;
var isSpacePressed = false;
var isPickingColorForId = null;

// قفل سراسری ممانعت از بازنویسی تنظیمات در هنگام اجرای موازی بارگذاری کلاینت/سرور
var isConfigLoading = true;

// تنظیمات دمای هوش مصنوعی (Temperature)
var ocrTemperature = 0.0;

// آرایه‌های مجهز شده به ۶ اسلات (۰: پیش‌فرض سیستمی، ۱ تا ۵: اختصاصی)
var loadedFonts = [null, null, null, null, null, null];
var loadedFontNames = ['Tahoma', null, null, null, null, null];
var fontCustomNames = ['', '', '', '', '', ''];

// متغیرهای مربوط به ارسال خودکار
var autoAdvanceTimerId = null;
var isAutoAdvancePending = false;

// متغیرهای ویرایش
var selectedMarking = null;
var isDraggingMarking = false;
var isResizingMarking = false;
var resizeHandleIndex = -1;
var dragOffsetX = 0, dragOffsetY = 0;
var resizeStartBounds = {};

// متغیرهای مربوط به undo
var historyStack = [];
var maxHistory = 10;

// متغیر انتخاب تم
var theme = localStorage.getItem('theme') || 'light';

// متغیر مربوط به نمایش متن اصلی/ترجمه
var showOriginal = true;

// متغیرهای جدید برای ابزارها
var magicWandTimer = null;
var isMagicWandProcessing = false;
var magicWandTolerance = 30;      
var magicWandBlur = 0.7;          
var magicWandEdgeSensitivity = 20;
var magicWandHoldMs = 500;
var globalTextSizeAdjust = 0; // -4..+4, default 0  
var rotationTimer = null;
var rotationTimeRemaining = 0;
var isRotationActive = false;

// ---- مقادیر پیش‌فرض و گام استروک ----
var defaultStrokeScale = parseFloat(localStorage.getItem('defaultStrokeScale')) || 1.0;
var strokeStep = parseFloat(localStorage.getItem('strokeStep')) || 0.5;
const MAX_STROKE = 16; 

// در انتهای فایل constants.js
var settingsFloatingPanel = document.getElementById('settings-floating-panel');
var settingsToggleBtn = document.getElementById('settings-toggle-btn');
var closeSettingsBtn = document.getElementById('close-settings-btn');