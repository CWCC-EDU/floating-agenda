大肥龙6.2sol

# 浮屿 · Windows 桌面日历

浮屿把月历、待办和便签放在 Windows 桌面上。按 `Win+D` 就能看到日历，切回其他应用时，应用窗口会显示在日历上方。

## 下载与上手

1. 在 [GitHub Releases](https://github.com/CWCC-EDU/floating-agenda/releases/latest) 下载 Windows x64 便携版 `Floating-Agenda-*-Windows-x64.exe`，双击即可运行。
2. 从旧版升级时，先右键托盘里的浮屿图标并退出，再运行新版。本机数据会继续使用。
3. 双击日历中的日期即可录入日程，内容会自动保存。点击托盘图标，或按 `Ctrl+Shift+Space`，可以显示或隐藏日历。

| 操作 | 入口 |
| --- | --- |
| 切换月份 | 点击日历顶部箭头，或在右上角菜单中选择月份 |
| 完成或恢复任务 | 双击任务，在编辑器中切换完成状态 |
| 设置重复任务 | 在任务编辑器中选择「重复」，例如每天或每周 |
| 调整位置和大小 | 右上角菜单 →「调整位置和大小」，调好后点「完成位置和大小调整」 |
| 设置开机启动或显示范围 | 右键托盘图标 |

把重复任务改为「不重复」时，编辑器会询问是否删除该系列的全部日程。

## 桌面层级和主题

- 在「日历设置 → 高级 → 桌面图标层级」选择图标上方或下方。默认在图标上方。选择下方时，日历会为重叠的图标和名称留出可点击区域。
- 如果桌面图标点击失效，可以右键托盘图标，选择「修复桌面图标点击」。
- 右上角菜单的「主题皮肤」提供透明日历、镰仓晚霞、蓝色弹珠，也可以导入本机 JPG、PNG 或 WebP。图片的位置、不透明度和压暗程度可分别调整。本机导入的图片保存在当前电脑。
- 「日历设置」还可调整月份布局、农历与节气、周数、字体、颜色、格子间距和快捷键。

## 待办顺延

在「日历设置 → 日历」开启「未完成任务自动顺延」后，符合设置范围的未完成任务会移到今天。可额外启用「顺延任务高亮」或「在原日期保留顺延分身」。两项默认关闭，高亮启用后默认使用红色。点原日期的「顺延」标记可打开当前任务。

## 桌面便签

在日历右上角菜单点击「新建便签」，每次都会打开一张独立便签。与日历重叠时，便签显示在日历上方。按住便签标题栏可以拖动。

- **＋ 新增**会打开另一张便签。
- **− 最小化**会收起当前便签，可在「管理便签」里重新打开。
- **× 销毁**会在确认后删除当前便签。「管理便签」也能批量销毁已关闭的空白便签。
- 右键便签正文可插入勾选框。选中文字后，可用底栏改变字体颜色。把光标放在某一行，点底栏「删除线」即可划掉整行，再点一次恢复。

## 坚果云同步

1. 打开「日历设置 → 同步」，填入坚果云账号邮箱和[第三方应用密码](https://help.jianguoyun.com/?p=2064)，点击「连接并检测」。
2. 开启「自动同步」后，应用会定期检查云端是否有更新。本机内容修改后也会在空闲约 8 秒后同步。检查间隔可设为 1、5、10、15、30 或 60 分钟，默认 5 分钟，每台电脑单独设置。
3. 需要现在同步时，在日历右上角菜单或同步设置页点击「立即同步」。关闭自动同步后仍可手动同步。
4. 如果本机和云端都改过，选择「上传本机」或「下载云端」。覆盖前会在本机的 `sync-backups` 文件夹保留备份。

日程、便签和日历设置保存在本机的 `%APPDATA%\floating-agenda\floating-agenda.json`。连接坚果云后，这些数据也会通过 HTTPS 同步到云端的 `floating-agenda/floating-agenda.json`。账号和应用密码使用 Windows 系统加密保存在本机。

## 从源码运行

在 Windows 上安装 [Node.js](https://nodejs.org/)，然后在项目目录运行以下命令。

```powershell
npm ci
npm run dev
npm test
npm run dist
```

项目使用 Electron、React、TypeScript 和 Vite。Electron 主进程位于 `electron/`，界面位于 `src/`，Windows 便携版输出到 `release/`。

## 致谢与图片来源

- 早期实现由 Kimi-K3.1pro 与大肥鱼V4.1F 协助完成，参考了 [Calendar-List](https://github.com/yq04/Calendar-List)。
- 「镰仓晚霞」由 Takashi Miyazaki 拍摄。 [原图](https://unsplash.com/photos/sunset-over-the-ocean-with-mountains-in-view-MVXTRL0sLK0) · [Unsplash 许可](https://unsplash.com/license)
- 「蓝色弹珠」由 NASA 阿波罗 17 号任务拍摄。 [NASA 图库](https://images.nasa.gov/details/as17-148-22727) · [版权说明](https://commons.wikimedia.org/wiki/File:The_Earth_seen_from_Apollo_17_(Original_Orientation).jpg)
