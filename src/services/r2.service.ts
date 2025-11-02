import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize R2 Client (S3-compatible)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'ventech-images';
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * Upload file to R2
 */
export const uploadToR2 = async (
  file: Express.Multer.File,
  folder: string = 'uploads'
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${folder}/${timestamp}-${sanitizedFilename}`;

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await r2Client.send(command);

    // Generate public URL
    // R2 public URL formats:
    // 1. R2.dev: https://[account-id].r2.dev/[bucket]/[key]
    // 2. Custom domain: https://[custom-domain]/[key]
    // Note: .r2.cloudflarestorage.com is the API endpoint, NOT public access
    
    let publicUrl: string;
    const accountId = process.env.R2_ACCOUNT_ID;
    
    if (PUBLIC_URL && !PUBLIC_URL.includes('.r2.cloudflarestorage.com')) {
      // Custom domain or R2.dev format provided
      if (PUBLIC_URL.includes('.r2.dev')) {
        // R2.dev format: https://[account-id].r2.dev
        const baseUrl = PUBLIC_URL.endsWith('/') ? PUBLIC_URL.slice(0, -1) : PUBLIC_URL;
        publicUrl = `${baseUrl}/${BUCKET_NAME}/${key}`;
      } else {
        // Custom domain - just append key
        const baseUrl = PUBLIC_URL.endsWith('/') ? PUBLIC_URL.slice(0, -1) : PUBLIC_URL;
        publicUrl = `${baseUrl}/${key}`;
      }
    } else {
      // Use R2.dev format (public access domain)
      // Format: https://[account-id].r2.dev/[bucket]/[key]
      publicUrl = `https://${accountId}.r2.dev/${BUCKET_NAME}/${key}`;
    }

    console.log('Uploaded to R2:', {
      bucket: BUCKET_NAME,
      key,
      publicUrl,
      accountId,
    });

    return {
      success: true,
      url: publicUrl,
    };
  } catch (error) {
    console.error('Error uploading to R2:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
};

/**
 * Upload multiple files to R2
 */
export const uploadMultipleToR2 = async (
  files: Express.Multer.File[],
  folder: string = 'uploads'
): Promise<{ success: boolean; urls?: string[]; error?: string }> => {
  try {
    const uploadPromises = files.map(file => uploadToR2(file, folder));
    const results = await Promise.all(uploadPromises);

    const failedUploads = results.filter(r => !r.success);
    if (failedUploads.length > 0) {
      return {
        success: false,
        error: `${failedUploads.length} file(s) failed to upload`,
      };
    }

    const urls = results.map(r => r.url!);
    return {
      success: true,
      urls,
    };
  } catch (error) {
    console.error('Error uploading multiple files to R2:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
};

/**
 * Delete file from R2
 */
export const deleteFromR2 = async (fileUrl: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Extract key from URL - handle both custom domain and R2.dev formats
    let key = fileUrl;
    
    // Remove protocol and domain
    if (PUBLIC_URL) {
      // Remove custom domain or R2.dev base URL
      const baseUrl = PUBLIC_URL.endsWith('/') ? PUBLIC_URL.slice(0, -1) : PUBLIC_URL;
      key = key.replace(baseUrl, '').replace(`/${BUCKET_NAME}`, '');
    }
    
    // Handle R2.dev format if still present
    if (key.includes('.r2.dev/')) {
      key = key.split('.r2.dev/')[1];
      if (key.startsWith(`${BUCKET_NAME}/`)) {
        key = key.replace(`${BUCKET_NAME}/`, '');
      }
    }
    
    // Remove leading slashes
    key = key.replace(/^\/+/, '');
    
    // Remove bucket name if still present
    if (key.startsWith(`${BUCKET_NAME}/`)) {
      key = key.replace(`${BUCKET_NAME}/`, '');
    }

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);

    return { success: true };
  } catch (error) {
    console.error('Error deleting from R2:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    };
  }
};

/**
 * Get signed URL for temporary private access
 */
export const getSignedUrlForR2 = async (
  key: string,
  expiresIn: number = 3600
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn });

    return {
      success: true,
      url: signedUrl,
    };
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate URL',
    };
  }
};

/**
 * List all files in R2 bucket (or a specific folder)
 */
export const listR2Files = async (
  folder?: string,
  maxKeys: number = 1000
): Promise<{ success: boolean; files?: Array<{ key: string; url: string; size?: number; lastModified?: Date }>; error?: string }> => {
  try {
    let prefix = '';
    if (folder) {
      prefix = folder.endsWith('/') ? folder : `${folder}/`;
    }

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await r2Client.send(command);

    if (!response.Contents) {
      return {
        success: true,
        files: [],
      };
    }

    // Generate public URLs for each file
    const accountId = process.env.R2_ACCOUNT_ID;
    const files = response.Contents
      .filter(item => item.Key && !item.Key.endsWith('/')) // Exclude folders
      .map(item => {
        let publicUrl: string;
        
        if (PUBLIC_URL && !PUBLIC_URL.includes('.r2.cloudflarestorage.com')) {
          if (PUBLIC_URL.includes('.r2.dev')) {
            const baseUrl = PUBLIC_URL.endsWith('/') ? PUBLIC_URL.slice(0, -1) : PUBLIC_URL;
            publicUrl = `${baseUrl}/${BUCKET_NAME}/${item.Key}`;
          } else {
            const baseUrl = PUBLIC_URL.endsWith('/') ? PUBLIC_URL.slice(0, -1) : PUBLIC_URL;
            publicUrl = `${baseUrl}/${item.Key}`;
          }
        } else {
          publicUrl = `https://${accountId}.r2.dev/${BUCKET_NAME}/${item.Key}`;
        }

        return {
          key: item.Key!,
          url: publicUrl,
          size: item.Size,
          lastModified: item.LastModified,
        };
      });

    return {
      success: true,
      files,
    };
  } catch (error) {
    console.error('Error listing R2 files:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list files',
    };
  }
};



