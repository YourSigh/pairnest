package __NATIVE_PACKAGE__

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.ActivityOptions
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class PairNestDownloadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
    val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
    val expectedId = context
      .getSharedPreferences(PairNestAppUpdateModule.PREFERENCES, Context.MODE_PRIVATE)
      .getLong(PairNestAppUpdateModule.KEY_DOWNLOAD_ID, -2L)
    if (downloadId <= 0 || downloadId != expectedId) return

    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId))
    val succeeded = cursor.use {
      it.moveToFirst() &&
        it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) ==
          DownloadManager.STATUS_SUCCESSFUL
    }
    if (!succeeded) return

    val installIntent = Intent(context, PairNestInstallActivity::class.java)
      .putExtra(DownloadManager.EXTRA_DOWNLOAD_ID, downloadId)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val installPendingIntent = createInstallPendingIntent(context, installIntent)
    showInstallNotification(context, installPendingIntent)

    // Android 14+ 需要显式声明这次 PendingIntent 可以从完成广播拉起安装界面。
    // 如果厂商系统仍然阻止，完成通知保留为兜底入口。
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val options = ActivityOptions.makeBasic().apply {
          pendingIntentBackgroundActivityStartMode =
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        }
        installPendingIntent.send(options.toBundle())
      } else {
        installPendingIntent.send()
      }
    } catch (_: Exception) {
      // Completion notification is the fallback.
    }
  }

  private fun createInstallPendingIntent(
    context: Context,
    installIntent: Intent,
  ): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      val creatorOptions = ActivityOptions.makeBasic().apply {
        pendingIntentCreatorBackgroundActivityStartMode =
          ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
      }
      return PendingIntent.getActivity(
        context,
        0,
        installIntent,
        flags,
        creatorOptions.toBundle(),
      )
    }
    return PendingIntent.getActivity(context, 0, installIntent, flags)
  }

  private fun showInstallNotification(
    context: Context,
    installPendingIntent: PendingIntent,
  ) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "应用更新",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = "安装 PairNest 新版本" },
      )
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("PairNest 更新已下载")
      .setContentText("点击继续安装新版本")
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(installPendingIntent)
      .build()
    try {
      manager.notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Android 13 未授权通知时，仍会尝试直接拉起安装页面。
    }
  }

  companion object {
    private const val CHANNEL_ID = "app-updates"
    private const val NOTIFICATION_ID = 7204
  }
}
