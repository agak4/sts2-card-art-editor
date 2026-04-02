using System;
using System.IO;
using System.Runtime.CompilerServices;
using Godot;
using HarmonyLib;
using MegaCrit.Sts2.Core.Modding;
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
				DefaultInterpolatedStringHandler defaultInterpolatedStringHandler;
				defaultInterpolatedStringHandler..ctor(33, 1);
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
			Control control = packedScene.Instantiate<Control>(0L);
			control.Name = "CardArtEditorOverlay";
			screen.AddChild(control, false, 0L);
			Bootstrap.Log("Overlay attached.");
		}

		// Token: 0x06000007 RID: 7 RVA: 0x00002390 File Offset: 0x00000590
		private static void Log(string message)
		{
			try
			{
				string text = ProjectSettings.GlobalizePath("user://card_art_editor");
				Directory.CreateDirectory(text);
				string text2 = Path.Combine(text, "bootstrap.log");
				DefaultInterpolatedStringHandler defaultInterpolatedStringHandler = new DefaultInterpolatedStringHandler(3, 3);
				defaultInterpolatedStringHandler.AppendLiteral("[");
				defaultInterpolatedStringHandler.AppendFormatted<DateTime>(DateTime.Now, "yyyy-MM-dd HH:mm:ss");
				defaultInterpolatedStringHandler.AppendLiteral("] ");
				defaultInterpolatedStringHandler.AppendFormatted(message);
				defaultInterpolatedStringHandler.AppendFormatted(Environment.NewLine);
				File.AppendAllText(text2, defaultInterpolatedStringHandler.ToStringAndClear());
			}
			catch
			{
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
	}
}
