package __NATIVE_PACKAGE__

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class PairNestAppUpdateModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun getName() = "PairNestAppUpdater"

  @ReactMethod
  fun downloadAndInstall(
    url: String,
    filename: String,
    trustedBaseUrl: String,
    promise: Promise,
  ) {
    try {
      val uri = Uri.parse(url)
      val trustedUri = Uri.parse(trustedBaseUrl)
      val downloadHost = uri.host
      val trustedHost = trustedUri.host
      if (
        uri.scheme != "https" ||
        trustedUri.scheme != "https" ||
        downloadHost.isNullOrBlank() ||
        trustedHost.isNullOrBlank() ||
        !downloadHost.equals(trustedHost, ignoreCase = true) ||
        effectivePort(uri) != effectivePort(trustedUri) ||
        uri.userInfo != null
      ) {
        throw IllegalArgumentException("下载地址不受信任")
      }
      if (!filename.matches(Regex("pairnest-[A-Za-z0-9._-]+\\.apk"))) {
        throw IllegalArgumentException("安装包文件名无效")
      }

      val request = DownloadManager.Request(uri)
        .setTitle("PairNest 正在下载更新")
        .setDescription(filename)
        .setMimeType(APK_MIME_TYPE)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)
        .setNotificationVisibility(
          DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
        )
        .setDestinationInExternalFilesDir(
          reactApplicationContext,
          Environment.DIRECTORY_DOWNLOADS,
          filename,
        )

      val manager = reactApplicationContext.getSystemService(
        Context.DOWNLOAD_SERVICE,
      ) as DownloadManager
      File(
        reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
        filename,
      ).takeIf { it.exists() }?.delete()
      val downloadId = manager.enqueue(request)
      reactApplicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putLong(KEY_DOWNLOAD_ID, downloadId)
        .apply()
      monitorDownload(downloadId)
      promise.resolve(downloadId.toDouble())
    } catch (error: Exception) {
      promise.reject("APP_UPDATE_DOWNLOAD_FAILED", error.message, error)
    }
  }

  private fun monitorDownload(downloadId: Long) {
    val manager = reactApplicationContext.getSystemService(
      Context.DOWNLOAD_SERVICE,
    ) as DownloadManager
    val startedAt = SystemClock.elapsedRealtime()
    val monitor = object : Runnable {
      override fun run() {
        val status = try {
          manager.query(DownloadManager.Query().setFilterById(downloadId)).use {
            if (!it.moveToFirst()) null else it.getInt(
              it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS),
            )
          }
        } catch (_: Exception) {
          null
        }

        when (status) {
          DownloadManager.STATUS_SUCCESSFUL -> {
            Log.i(LOG_TAG, "Download completed: $downloadId")
            openInstallerWhileAppIsVisible(downloadId)
          }
          DownloadManager.STATUS_FAILED -> {
            Log.w(LOG_TAG, "Download failed: $downloadId")
          }
          else -> {
            if (SystemClock.elapsedRealtime() - startedAt < MONITOR_TIMEOUT_MS) {
              mainHandler.postDelayed(this, MONITOR_INTERVAL_MS)
            }
          }
        }
      }
    }
    mainHandler.post(monitor)
  }

  private fun openInstallerWhileAppIsVisible(downloadId: Long) {
    val activity = reactApplicationContext.currentActivity ?: return
    if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) return

    val intent = Intent(activity, PairNestInstallActivity::class.java)
      .putExtra(DownloadManager.EXTRA_DOWNLOAD_ID, downloadId)
    activity.startActivity(intent)
  }

  private fun effectivePort(uri: Uri): Int {
    if (uri.port >= 0) return uri.port
    return if (uri.scheme == "https") 443 else 80
  }

  companion object {
    const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    const val PREFERENCES = "pairnest_app_update"
    const val KEY_DOWNLOAD_ID = "download_id"
    private const val LOG_TAG = "PairNestAppUpdate"
    private const val MONITOR_INTERVAL_MS = 1_000L
    private const val MONITOR_TIMEOUT_MS = 2 * 60 * 60_000L
  }
}
