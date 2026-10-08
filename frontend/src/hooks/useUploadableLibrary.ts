import { App } from 'antd';
import type { UploadFile } from 'antd';
import { useState } from 'react';

interface UploadableLibraryOptions<T extends { id: number; label: string }> {
  list: () => Promise<{ data?: T[] }>;
  upload: (label: string, file: File) => Promise<T>;
  remove: (id: number) => Promise<unknown>;
  onUploaded: (created: T) => void;
  onDeleted: (id: number) => void;
  // "Nhập nhãn và chọn file zip trước" / "...file .php trước" - the only
  // bit of copy that actually differs between zip/theme/mu-plugin.
  missingFileMessage: string;
}

/** 1 thư viện "upload file -> chọn dùng -> xoá" (zip plugin, zip theme,
 * mu-plugin ở plugin-manager/index.tsx) - 3 khối state/logic giống nhau
 * 100% ngoại trừ cách trang cập nhật selection sau upload/xoá (mảng id vs 1
 * id), nên phần đó ở ngoài qua onUploaded/onDeleted thay vì hook tự đoán
 * selection là single hay multi. */
export function useUploadableLibrary<T extends { id: number; label: string }>({
  list,
  upload,
  remove,
  onUploaded,
  onDeleted,
  missingFileMessage,
}: UploadableLibraryOptions<T>) {
  const { message } = App.useApp();
  const [library, setLibrary] = useState<T[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const uploadFile = uploadFileList[0]?.originFileObj as File | undefined;

  const refresh = () => list().then((res) => setLibrary(res.data || []));

  const handleUpload = async () => {
    if (!uploadFile || !uploadLabel.trim()) {
      message.warning(missingFileMessage);
      return;
    }
    setUploading(true);
    try {
      const created = await upload(uploadLabel.trim(), uploadFile);
      message.success(`Đã thêm "${created.label}" vào thư viện`);
      await refresh();
      onUploaded(created);
      setUploadOpen(false);
      setUploadLabel('');
      setUploadFileList([]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    await remove(id);
    message.success('Đã xoá khỏi thư viện');
    onDeleted(id);
    refresh();
  };

  return {
    library,
    refresh,
    uploadOpen,
    setUploadOpen,
    uploadLabel,
    setUploadLabel,
    uploadFileList,
    setUploadFileList,
    uploading,
    uploadFile,
    handleUpload,
    handleDelete,
  };
}
