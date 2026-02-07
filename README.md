# Discogs → Douban Music Collect

一个 **从 Discogs 一键采集专辑信息并自动填写到豆瓣音乐** 的浏览器插件。  
适合经常在 Discogs 查资料、却需要手动在豆瓣建条目的用户。

> **最大程度保留 Discogs 原始信息结构 + 减少重复劳动**。

---

## ✨ 功能特性

### 🎵 Discogs 侧
- ✅ 一键采集专辑信息（Collect 按钮）
- ✅ 自动解析：
  - 专辑名
  - 艺人（支持多个艺人，去 `(1)(2)`、`*` 等 Discogs 标记）
  - 流派（Genre，自动取第一个主流派）
  - 发行时间（多结构兜底解析）
  - 厂牌（Label）
  - 介质（Vinyl / CD / Digital 等）
  - 条形码（EAN / UPC）
- ✅ **高鲁棒性曲目表解析**
  - 支持有 / 无曲号
  - 支持多碟（1.1 / 2.3）
  - 修复 Discogs 拆行、孤立 `–`、时长错位等问题
- ✅ 自动下载专辑封面（避免重复下载）

---

### 🔍 Discogs → 豆瓣搜索
- ✅ 在 Discogs 条目页面右上角显示 **Search** 按钮
- ✅ 一键跳转到豆瓣音乐搜索
- ✅ 同时使用 **艺人 + 专辑名**
- ✅ 自动去除艺人名中的 `*`、`(1)` 等 Discogs 噪音

---

### 📘 豆瓣侧
- ✅ 自动填写：
  - 专辑名
  - 艺人
  - 发行时间
  - 厂牌
  - 条形码
  - 曲目表
  - 简介（Notes）
- ✅ 自动选择：
  - 流派（英文 → 豆瓣中文映射）
  - 专辑类型（Album / EP / Single）
  - 介质（黑胶 / CD / 数字）
- ✅ 支持豆瓣 **两步新建流程**
- ✅ 跨页面状态保存（不会丢数据）

---

## 📦 安装方法

### 本地加载

1. 下载或 clone 本项目压缩包到本地并解压
2. 打开 Chrome浏览器
3. 在地址栏输入：

   chrome://extensions

4. 打开右上角 **开发者模式**
5. 点击 **加载已解压的扩展程序**
6. 选择本项目根目录（包含 `manifest.json`）

安装完成后：
- Discogs 的 release / master 页面会显示 **Collect / Search** 按钮
- 豆瓣新建音乐页面会自动执行填写

## ⚠️ 注意事项

### 关于 Genre（流派）

- Discogs 允许多个 Genre（如 `Jazz, Children's`）
- 插件 **只取第一个主流派**
- 其余流派不会自动填写，以避免豆瓣分类混乱

### Discogs需要是英文界面，其它语言界面可能导致提取失败

---

## 🧩 项目结构

```text
├─ background.js
│  ├─ 草稿存储（SAVE / GET / CLEAR）
│  ├─ 封面下载
│  └─ 访问 Discogs artist 页面解析规范艺人名
│
├─ content.js
│  ├─ Discogs 信息采集
│  ├─ 曲目表解析（核心逻辑）
│  ├─ Notes 原样提取
│  ├─ 豆瓣自动填写
│  └─ Collect 按钮
│
├─ content_search.js
│  ├─ Discogs Search 按钮
│  └─ 跳转豆瓣搜索（artist + album）
│
└─ manifest.json
