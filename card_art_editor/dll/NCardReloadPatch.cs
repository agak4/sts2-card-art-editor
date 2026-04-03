using System;
using System.Runtime.CompilerServices;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Cards;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000006 RID: 6
	[HarmonyPatch(typeof(NCard), "Reload")]
	internal static class NCardReloadPatch
	{
		// Token: 0x0600000E RID: 14 RVA: 0x0000288D File Offset: 0x00000A8D
		[NullableContext(1)]
		private static void Postfix(NCard __instance)
		{
			Bootstrap.RefreshCardOverrides(__instance);
		}
	}
}
