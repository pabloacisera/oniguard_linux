export const contentTypes = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
    'txt': 'text/plain',
    'md': 'text/markdown',

    'svg': 'image/svg+xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'avif': 'image/avif',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',

    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'eot': 'application/vnd.ms-fontobject',

    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'm4a': 'audio/mp4',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
    'opus': 'audio/opus',

    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogv': 'video/ogg',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'mkv': 'video/x-matroska',
    'flv': 'video/x-flv',
    'mpeg': 'video/mpeg',
    'mpg': 'video/mpeg',

    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed'
};

export const binaryExtensions = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'tif',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus',
    'mp4', 'webm', 'ogv', 'avi', 'mov', 'mkv', 'flv', 'mpeg', 'mpg',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z'
]);

export const noHashExtensions = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'tif',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus',
    'mp4', 'webm', 'ogv', 'avi', 'mov', 'mkv', 'flv', 'mpeg', 'mpg',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z',
    'svg'
]);