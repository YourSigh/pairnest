package __NATIVE_PACKAGE__

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast

class PairNestInstallActivity : Activity() {
  private var downloadId: Long = -1L

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
    if (downloadId <= 0) {
      finish()
      return
    }
    continueInstall()
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != UNKNOWN_SOURCES_REQUEST) return
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      !packageManager.canRequestPackageInstalls()
    ) {
      Toast.makeText(this, "需要允许安装未知应用才能继续更新", Toast.LENGTH_LONG).show()
      finish()
      return
    }
    openPackageInstaller()
  }

  private fun continueInstall() {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      !packageManager.canRequestPackageInstalls()
    ) {
      startActivityForResult(
        Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:$packageName"),
        ),
        UNKNOWN_SOURCES_REQUEST,
      )
      return
    }

    openPackageInstaller()
  }

  private fun openPackageInstaller() {
    val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val apkUri = manager.getUriForDownloadedFile(downloadId)
    if (apkUri == null) {
      Toast.makeText(this, "没有找到已下载的安装包", Toast.LENGTH_LONG).show()
      finish()
      return
    }

    try {
      startActivity(
        Intent(Intent.ACTION_VIEW)
          .setDataAndType(apkUri, PairNestAppUpdateModule.APK_MIME_TYPE)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: Exception) {
      Toast.makeText(this, "无法打开系统安装程序", Toast.LENGTH_LONG).show()
    } finally {
      finish()
    }
  }

  companion object {
    private const val UNKNOWN_SOURCES_REQUEST = 7205
  }
}
