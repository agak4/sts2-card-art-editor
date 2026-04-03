using System;
using System.IO;
using System.Runtime.CompilerServices;
using Godot;
using HarmonyLib;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Cards;
using MegaCrit.Sts2.Core.Nodes.Screens;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000002 RID: 2
	[NullableContext(1)]
	[Nullable(0)]
	[ModInitializer("Init")]
	public static class Bootstrap
	{
		// Token: 0x06000001 RID: 1 RVA: 0x00002050 File Offset: 0x00000250
		public static void Init()
		{
			try
			{
				Bootstrap.Log("Init start.");
				Bootstrap.Harmony.PatchAll(typeof(Bootstrap).Assembly);
				Bootstrap.TryEnsureManager();
				Bootstrap.TryAttachToOpenInspectScreens();
				Bootstrap.Log("Init complete.");
			}
			catch (Exception ex)
			{
				string str = "Init failed: ";
				Exception ex2 = ex;
				Bootstrap.Log(str + ((ex2 != null) ? ex2.ToString() : null));
				DefaultInterpolatedStringHandler defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(33, 1);
				defaultInterpolatedStringHandler.AppendLiteral("CardArtEditor: bootstrap failed: ");
				defaultInterpolatedStringHandler.AppendFormatted<Exception>(ex);
				GD.PushError(defaultInterpolatedStringHandler.ToStringAndClear());
			}
		}

		// Token: 0x06000002 RID: 2 RVA: 0x000020F0 File Offset: 0x000002F0
		internal static void OnInspectCardScreenReady(NInspectCardScreen screen)
		{
			try
			{
				DefaultInterpolatedStringHandler defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(22, 1);
				defaultInterpolatedStringHandler.AppendLiteral("Inspect screen ready: ");
				defaultInterpolatedStringHandler.AppendFormatted<StringName>((screen != null) ? screen.Name : null);
				Bootstrap.Log(defaultInterpolatedStringHandler.ToStringAndClear());
				if (screen != null && GodotObject.IsInstanceValid(screen))
				{
					if (Bootstrap.TryEnsureManager() == null)
					{
						Bootstrap.Log("Manager was not available during inspect screen ready.");
					}
					else
					{
						Bootstrap.AttachOverlay(screen);
					}
				}
			}
			catch (Exception ex)
			{
				string str = "OnInspectCardScreenReady failed: ";
				Exception ex2 = ex;
				Bootstrap.Log(str + ((ex2 != null) ? ex2.ToString() : null));
			}
		}

		// Token: 0x06000003 RID: 3 RVA: 0x00002188 File Offset: 0x00000388
		[NullableContext(2)]
		private static Node TryEnsureManager()
		{
			SceneTree sceneTree = Engine.GetMainLoop() as SceneTree;
			Window window = (sceneTree != null) ? sceneTree.Root : null;
			if (window == null)
			{
				Bootstrap.Log("SceneTree root unavailable.");
				return null;
			}
			Node nodeOrNull = window.GetNodeOrNull<Node>("CardArtOverrideManager");
			if (nodeOrNull != null)
			{
				return nodeOrNull;
			}
			GDScript gdscript = ResourceLoader.Load("res://mods/card_art_editor/card_art_override_manager.gd", "", 1L) as GDScript;
			if (gdscript == null)
			{
				Bootstrap.Log("Failed to load manager script at 'res://mods/card_art_editor/card_art_override_manager.gd'.");
				return null;
			}
			Node node = gdscript.New(Array.Empty<Variant>()).AsGodotObject() as Node;
			if (node == null)
			{
				Bootstrap.Log("Manager script did not instantiate a Node.");
				return null;
			}
			node.Name = "CardArtOverrideManager";
			window.AddChild(node, false, 0L);
			Bootstrap.Log("Manager node added to /root.");
			return node;
		}

		// Token: 0x06000004 RID: 4 RVA: 0x00002248 File Offset: 0x00000448
		private static void TryAttachToOpenInspectScreens()
		{
			SceneTree sceneTree = Engine.GetMainLoop() as SceneTree;
			Window window = (sceneTree != null) ? sceneTree.Root : null;
			if (window == null)
			{
				return;
			}
			foreach (Node node in window.GetChildren(false))
			{
				Bootstrap.ScanNode(node);
			}
		}

		// Token: 0x06000005 RID: 5 RVA: 0x000022B0 File Offset: 0x000004B0
		private static void ScanNode(Node node)
		{
			NInspectCardScreen ninspectCardScreen = node as NInspectCardScreen;
			if (ninspectCardScreen != null)
			{
				Bootstrap.OnInspectCardScreenReady(ninspectCardScreen);
			}
			foreach (Node node2 in node.GetChildren(false))
			{
				if (node2 != null)
				{
					Node node3 = node2;
					Bootstrap.ScanNode(node3);
				}
			}
		}

		// Token: 0x06000006 RID: 6 RVA: 0x00002314 File Offset: 0x00000514
		private static void AttachOverlay(Control screen)
		{
			if (screen.GetNodeOrNull<Node>("CardArtEditorOverlay") != null)
			{
				Bootstrap.Log("Overlay already attached.");
				return;
			}
			PackedScene packedScene = ResourceLoader.Load("res://mods/card_art_editor/inspect_card_art_editor.tscn", "", 1L) as PackedScene;
			if (packedScene == null)
			{
				Bootstrap.Log("Failed to load overlay scene at 'res://mods/card_art_editor/inspect_card_art_editor.tscn'.");
				return;
			}
			Control overlay = packedScene.Instantiate<Control>(0L);
			overlay.Name = "CardArtEditorOverlay";
			screen.AddChild(overlay, false, 0L);
			Variant script = overlay.GetScript();
			string text = (script.VariantType == null) ? "<null>" : script.ToString();
			Button nodeOrNull = overlay.GetNodeOrNull<Button>("EditArtButton");
			Control nodeOrNull2 = overlay.GetNodeOrNull<Control>("EditorPopup");
			string[] array = new string[9];
			array[0] = "Overlay attached. overlay_type=";
			array[1] = overlay.GetType().FullName;
			array[2] = ", script=";
			array[3] = text;
			array[4] = ", ";
			int num = 5;
			DefaultInterpolatedStringHandler defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(18, 1);
			defaultInterpolatedStringHandler.AppendLiteral("has_edit_method=");
			defaultInterpolatedStringHandler.AppendFormatted<bool>(overlay.HasMethod("_on_edit_art_pressed"));
			defaultInterpolatedStringHandler.AppendLiteral(", ");
			array[num] = defaultInterpolatedStringHandler.ToStringAndClear();
			int num2 = 6;
			defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(18, 1);
			defaultInterpolatedStringHandler.AppendLiteral("has_open_method=");
			defaultInterpolatedStringHandler.AppendFormatted<bool>(overlay.HasMethod("_open_editor_popup"));
			defaultInterpolatedStringHandler.AppendLiteral(", ");
			array[num2] = defaultInterpolatedStringHandler.ToStringAndClear();
			int num3 = 7;
			defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(16, 1);
			defaultInterpolatedStringHandler.AppendLiteral("button_exists=");
			defaultInterpolatedStringHandler.AppendFormatted<bool>(nodeOrNull != null);
			defaultInterpolatedStringHandler.AppendLiteral(", ");
			array[num3] = defaultInterpolatedStringHandler.ToStringAndClear();
			int num4 = 8;
			defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(13, 1);
			defaultInterpolatedStringHandler.AppendLiteral("popup_exists=");
			defaultInterpolatedStringHandler.AppendFormatted<bool>(nodeOrNull2 != null);
			array[num4] = defaultInterpolatedStringHandler.ToStringAndClear();
			Bootstrap.Log(string.Concat(array));
			if (nodeOrNull != null)
			{
				string str = "EditArtButton state: ";
				defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(21, 2);
				defaultInterpolatedStringHandler.AppendLiteral("visible=");
				defaultInterpolatedStringHandler.AppendFormatted<bool>(nodeOrNull.Visible);
				defaultInterpolatedStringHandler.AppendLiteral(", disabled=");
				defaultInterpolatedStringHandler.AppendFormatted<bool>(nodeOrNull.Disabled);
				defaultInterpolatedStringHandler.AppendLiteral(", ");
				string str2 = defaultInterpolatedStringHandler.ToStringAndClear();
				defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(31, 3);
				defaultInterpolatedStringHandler.AppendLiteral("position=");
				defaultInterpolatedStringHandler.AppendFormatted<Vector2>(nodeOrNull.Position);
				defaultInterpolatedStringHandler.AppendLiteral(", size=");
				defaultInterpolatedStringHandler.AppendFormatted<Vector2>(nodeOrNull.Size);
				defaultInterpolatedStringHandler.AppendLiteral(", mouse_filter=");
				defaultInterpolatedStringHandler.AppendFormatted<int>(nodeOrNull.MouseFilter);
				Bootstrap.Log(str + str2 + defaultInterpolatedStringHandler.ToStringAndClear());
				nodeOrNull.Pressed += delegate()
				{
					Control nodeOrNull3 = overlay.GetNodeOrNull<Control>("EditorPopup");
					string[] array2 = new string[5];
					array2[0] = "EditArtButton pressed from bootstrap. ";
					int num5 = 1;
					DefaultInterpolatedStringHandler defaultInterpolatedStringHandler2 = new DefaultInterpolatedStringHandler(21, 1);
					defaultInterpolatedStringHandler2.AppendLiteral("overlay_has_method=");
					defaultInterpolatedStringHandler2.AppendFormatted<bool>(overlay.HasMethod("_on_edit_art_pressed"));
					defaultInterpolatedStringHandler2.AppendLiteral(", ");
					array2[num5] = defaultInterpolatedStringHandler2.ToStringAndClear();
					int num6 = 2;
					defaultInterpolatedStringHandler2 = new DefaultInterpolatedStringHandler(15, 1);
					defaultInterpolatedStringHandler2.AppendLiteral("popup_exists=");
					defaultInterpolatedStringHandler2.AppendFormatted<bool>(nodeOrNull3 != null);
					defaultInterpolatedStringHandler2.AppendLiteral(", ");
					array2[num6] = defaultInterpolatedStringHandler2.ToStringAndClear();
					array2[3] = "popup_visible_before=";
					array2[4] = ((nodeOrNull3 == null) ? "<null>" : nodeOrNull3.Visible.ToString());
					Bootstrap.Log(string.Concat(array2));
				};
			}
		}

		// Token: 0x06000007 RID: 7 RVA: 0x00002604 File Offset: 0x00000804
		private static void Log(string message)
		{
			try
			{
				string text = ProjectSettings.GlobalizePath("user://card_art_editor");
				Directory.CreateDirectory(text);
				string path = Path.Combine(text, "bootstrap.log");
				DefaultInterpolatedStringHandler defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(3, 3);
				defaultInterpolatedStringHandler.AppendLiteral("[");
				defaultInterpolatedStringHandler.AppendFormatted<DateTime>(DateTime.Now, "yyyy-MM-dd HH:mm:ss");
				defaultInterpolatedStringHandler.AppendLiteral("] ");
				defaultInterpolatedStringHandler.AppendFormatted(message);
				defaultInterpolatedStringHandler.AppendFormatted(Environment.NewLine);
				File.AppendAllText(path, defaultInterpolatedStringHandler.ToStringAndClear());
			}
			catch
			{
			}
		}

		// Token: 0x06000008 RID: 8 RVA: 0x00002694 File Offset: 0x00000894
		internal static void UpdateInspectCardMetadata(NInspectCardScreen screen)
		{
			try
			{
				if (screen != null && GodotObject.IsInstanceValid(screen))
				{
					NCard value = Traverse.Create(screen).Field("_card").GetValue<NCard>();
					if (value != null && GodotObject.IsInstanceValid(value))
					{
						CardModel model = value.Model;
						if (model == null)
						{
							value.SetMeta("_card_art_inspect_source_path", string.Empty);
							value.SetMeta("_card_art_inspect_card_id", string.Empty);
						}
						else
						{
							value.SetMeta("_card_art_inspect_source_path", model.PortraitPath ?? string.Empty);
							value.SetMeta("_card_art_inspect_card_id", model.Id.Entry ?? string.Empty);
						}
					}
				}
			}
			catch (Exception ex)
			{
				string str = "UpdateInspectCardMetadata failed: ";
				Exception ex2 = ex;
				Bootstrap.Log(str + ((ex2 != null) ? ex2.ToString() : null));
			}
		}

		// Token: 0x06000009 RID: 9 RVA: 0x00002798 File Offset: 0x00000998
		internal static void RefreshCardOverrides(NCard card)
		{
			try
			{
				if (card != null && GodotObject.IsInstanceValid(card))
				{
					Node node = Bootstrap.TryEnsureManager();
					if (node != null)
					{
						TextureRect nodeOrNull = card.GetNodeOrNull<TextureRect>("CardContainer/PortraitCanvasGroup/Portrait");
						if (nodeOrNull != null)
						{
							node.Call("apply_override_to_texture_rect", new Variant[]
							{
								nodeOrNull
							});
						}
						TextureRect nodeOrNull2 = card.GetNodeOrNull<TextureRect>("CardContainer/PortraitCanvasGroup/AncientPortrait");
						if (nodeOrNull2 != null)
						{
							node.Call("apply_override_to_texture_rect", new Variant[]
							{
								nodeOrNull2
							});
						}
					}
				}
			}
			catch (Exception ex)
			{
				string str = "RefreshCardOverrides failed: ";
				Exception ex2 = ex;
				Bootstrap.Log(str + ((ex2 != null) ? ex2.ToString() : null));
			}
		}

		// Token: 0x04000001 RID: 1
		private static readonly Harmony Harmony = new Harmony("ysg05.card_art_editor");

		// Token: 0x04000002 RID: 2
		private const string ManagerNodeName = "CardArtOverrideManager";

		// Token: 0x04000003 RID: 3
		private const string ManagerScriptPath = "res://mods/card_art_editor/card_art_override_manager.gd";

		// Token: 0x04000004 RID: 4
		private const string OverlayScenePath = "res://mods/card_art_editor/inspect_card_art_editor.tscn";

		// Token: 0x04000005 RID: 5
		internal const string InspectSourcePathMeta = "_card_art_inspect_source_path";

		// Token: 0x04000006 RID: 6
		internal const string InspectCardIdMeta = "_card_art_inspect_card_id";
	}
}
