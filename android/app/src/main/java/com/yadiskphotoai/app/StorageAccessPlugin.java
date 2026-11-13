package com.yadiskphotoai.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Доступ ко всем файлам устройства (MANAGE_EXTERNAL_STORAGE).
 * Нужен для чтения и переименования файлов вне специфичных для приложения папок.
 */
@CapacitorPlugin(name = "StorageAccess")
public class StorageAccessPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("granted", hasAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        JSObject ret = new JSObject();
        if (hasAccess()) {
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // До Android 6 разрешения выдаются при установке.
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                ret.put("granted", false);
                ret.put("opened", true);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(intent);
                    ret.put("granted", false);
                    ret.put("opened", true);
                } catch (Exception e2) {
                    ret.put("granted", false);
                    ret.put("opened", false);
                    ret.put("error", String.valueOf(e2.getMessage()));
                }
            }
            call.resolve(ret);
            return;
        }
        // Android 6–10: обычный runtime-запрос записи на внешний носитель.
        getActivity().requestPermissions(
                new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
                        android.Manifest.permission.READ_EXTERNAL_STORAGE},
                9012);
        ret.put("granted", false);
        ret.put("opened", true);
        call.resolve(ret);
    }

    private boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return getContext().checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }
}
